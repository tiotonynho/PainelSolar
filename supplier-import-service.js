'use strict';

const crypto=require('node:crypto');
const {CsvSupplierAdapter}=require('./csv-supplier-adapter');
const Core=require('./catalog-core');
const ImportCore=require('./supplier-import-core');

const BATCH_STATUSES=Object.freeze(['RECEIVED','PARSING','VALIDATING','REVIEW_REQUIRED','READY_TO_PUBLISH','PUBLISHED','FAILED','CANCELLED']);
const ITEM_STATUSES=Object.freeze(['MATCHED','UNMATCHED','INVALID','DUPLICATE','REVIEW_REQUIRED','PUBLISHED']);
const loggerDefault={info(){},warn(){}};
const json=value=>JSON.stringify(value??null);
const parseJson=(value,fallback)=>{try{return value===null||value===undefined?fallback:JSON.parse(value);}catch{return fallback;}};
const nowValue=value=>Number.isInteger(Number(value))?Number(value):Date.now();
const fail=(message,status=400,details)=>Object.assign(new Error(message),{status,details});
const clone=value=>JSON.parse(JSON.stringify(value));

function normalizeStoredBatch(row){
  if(!row)return null;
  return {...row,supplierId:row.supplier_id,sourceType:row.source_type,fileName:row.file_name,sourceHash:row.source_hash,delimiter:row.delimiter,decimalFormat:row.decimal_format,mapping:parseJson(row.mapping_json,{}),totalRecords:row.total_records,validRecords:row.valid_records,invalidRecords:row.invalid_records,warningRecords:row.warning_records,matchedRecords:row.matched_records,unmatchedRecords:row.unmatched_records,newRecords:row.new_records,updatedRecords:row.updated_records,unchangedRecords:row.unchanged_records,priceChanges:row.price_changes,stockChanges:row.stock_changes,errors:parseJson(row.errors_json,[]),warnings:parseJson(row.warnings_json,[]),createdAt:row.created_at,createdBy:row.created_by,validatedAt:row.validated_at,publishedAt:row.published_at,publishedBy:row.published_by};
}

function normalizeStoredItem(row){
  if(!row)return null;
  return {...row,batchId:row.batch_id,rowNumber:row.row_number,entityType:row.entity_type,externalSku:row.external_sku,rawData:parseJson(row.raw_data_json,{}),normalizedData:parseJson(row.normalized_data_json,null),errors:parseJson(row.errors_json,[]),warnings:parseJson(row.warnings_json,[]),matchedProductId:row.matched_product_id,matchedKitId:row.matched_kit_id,publishedEntityId:row.published_entity_id,createdAt:row.created_at,updatedAt:row.updated_at};
}

function normalizedStock(value){
  const raw=String(value||'UNKNOWN').toUpperCase();return raw==='IN_STOCK'?'AVAILABLE':raw==='PRE_ORDER'?'UNKNOWN':raw;
}

function createSupplierImportService(db,{logger=loggerDefault,config=ImportCore.DEFAULT_IMPORT_CONFIG}={}){
  const batchColumns='id,supplier_id,source_type,file_name,source_hash,status,delimiter,decimal_format,mapping_json,total_records,valid_records,invalid_records,warning_records,matched_records,unmatched_records,new_records,updated_records,unchanged_records,price_changes,stock_changes,errors_json,warnings_json,created_at,created_by,validated_at,published_at,published_by';
  const itemColumns='id,batch_id,row_number,entity_type,external_sku,raw_data_json,normalized_data_json,status,errors_json,warnings_json,matched_product_id,matched_kit_id,published_entity_id,created_at,updated_at';
  const auditRow=row=>row&&({...row,details:parseJson(row.details_json,{})});
  const batchRow=id=>db.prepare(`SELECT ${batchColumns} FROM supplier_import_batches WHERE id=?`).get(id);
  const itemRow=id=>db.prepare(`SELECT ${itemColumns} FROM supplier_import_items WHERE id=?`).get(id);
  const supplierRow=id=>db.prepare('SELECT id,name,slug,active,integration_type FROM suppliers WHERE id=?').get(id);
  const productRow=id=>db.prepare('SELECT id,category,manufacturer,model,description,specifications_json,active FROM products WHERE id=?').get(id);
  const kitRow=id=>db.prepare('SELECT id,name,slug,active FROM kits WHERE id=?').get(id);
  const currentProductLink=(supplierId,sku)=>db.prepare('SELECT id,supplier_id,product_id,supplier_sku,supplier_name,supplier_url,active,last_sync_at FROM supplier_products WHERE supplier_id=? AND supplier_sku=?').get(supplierId,sku);
  const currentKitLink=(supplierId,sku)=>db.prepare('SELECT id,supplier_id,kit_id,supplier_sku,supplier_name,supplier_url,active,last_sync_at FROM supplier_kits WHERE supplier_id=? AND supplier_sku=?').get(supplierId,sku);
  const productOffer=linkId=>db.prepare('SELECT * FROM supplier_offers WHERE supplier_product_id=? ORDER BY captured_at DESC,id DESC LIMIT 1').get(linkId);
  const kitOffer=linkId=>db.prepare('SELECT * FROM supplier_kit_offers WHERE supplier_kit_id=? ORDER BY captured_at DESC,id DESC LIMIT 1').get(linkId);
  const getBatch=id=>normalizeStoredBatch(batchRow(id));
  const getItem=id=>normalizeStoredItem(itemRow(id));

  function listBatches(supplierId){
    const sql=supplierId?`SELECT ${batchColumns} FROM supplier_import_batches WHERE supplier_id=? ORDER BY created_at DESC,id DESC`:`SELECT ${batchColumns} FROM supplier_import_batches ORDER BY created_at DESC,id DESC`;
    return (supplierId?db.prepare(sql).all(supplierId):db.prepare(sql).all()).map(normalizeStoredBatch);
  }
  function listItems(batchId){return db.prepare(`SELECT ${itemColumns} FROM supplier_import_items WHERE batch_id=? ORDER BY row_number`).all(batchId).map(normalizeStoredItem);}
  function audit(batchId){return db.prepare('SELECT id,batch_id,action,actor_id,created_at,details_json FROM supplier_import_audit WHERE batch_id=? ORDER BY created_at,id').all(batchId).map(auditRow);}
  function writeAudit(batchId,action,actorId,details={}){db.prepare('INSERT INTO supplier_import_audit(id,batch_id,action,actor_id,created_at,details_json) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),batchId,action,actorId||null,Date.now(),json(details));}

  function matchProduct(supplierId,data){
    const link=currentProductLink(supplierId,data.supplierSku);
    if(link&&productRow(link.product_id))return {productId:link.product_id,warning:null};
    if(data.productId&&productRow(data.productId))return {productId:data.productId,warning:null};
    const rows=db.prepare('SELECT id FROM products WHERE active=1 AND category=? AND lower(manufacturer)=lower(?) AND lower(model)=lower(?)').all(data.category,data.manufacturer,data.model);
    if(rows.length===1)return {productId:rows[0].id,warning:'PRODUCT_MATCHED_BY_ATTRIBUTES'};
    return {productId:null,warning:'PRODUCT_UNMATCHED'};
  }
  function matchKit(data){
    const kit=kitRow(data.kitId);return kit?{kitId:kit.id,warning:kit.active?'': 'KIT_INACTIVE_REVIEW'}:{kitId:null,warning:'KIT_UNMATCHED'};
  }

  function currentForItem(supplierId,item){
    if(item.entityType==='KIT_OFFER'){
      const link=currentKitLink(supplierId,item.normalizedData?.kitSku||item.externalSku);return {link,current:link?kitOffer(link.id):null};
    }
    const link=currentProductLink(supplierId,item.externalSku);return {link,current:link?productOffer(link.id):null};
  }
  function diffItem(supplierId,item){
    if(!item.normalizedData||item.status==='INVALID'||item.status==='DUPLICATE'||item.status==='UNMATCHED')return {rowNumber:item.rowNumber,sku:item.externalSku,entityType:item.entityType,kind:'UNMATCHED',current:null,next:item.normalizedData,priceChanged:false,stockChanged:false,warning:null};
    const {link,current}=currentForItem(supplierId,item),next=item.normalizedData;
    const currentPrice=current?.price===null||current?.price===undefined?null:Number(current.price),nextPrice=next.price;
    const currentStock=normalizedStock(current?.stock_status),nextStock=next.stockStatus;
    const priceChanged=currentPrice===null?nextPrice!==null:currentPrice!==nextPrice;
    const stockChanged=!!current&&currentStock!==nextStock;
    let warning=null;
    if(priceChanged&&currentPrice>0&&Math.abs(nextPrice-currentPrice)/currentPrice>Number(config.priceVariationThreshold))warning='PRICE_CHANGE_REVIEW_REQUIRED';
    return {rowNumber:item.rowNumber,sku:item.externalSku,entityType:item.entityType,kind:link?'UPDATE':'NEW',current:current?{price:currentPrice,currency:current.currency,stockStatus:currentStock,stockQuantity:current.stock_quantity}:null,next:next,priceChanged,stockChanged,warning,linkId:link?.id||null};
  }
  function buildDiff(batch){
    const items=listItems(batch.id),diff=items.map(item=>diffItem(batch.supplierId,item));
    const valid=diff.filter(item=>item.kind==='NEW'||item.kind==='UPDATE'||item.kind==='UNMATCHED');
    const existing=diff.filter(item=>item.kind==='UPDATE');
    const changed=existing.filter(item=>item.priceChanged||item.stockChanged);
    const currentCount=existing.length,newCount=diff.filter(item=>item.kind==='NEW').length;
    const mass=currentCount>0&&changed.length/currentCount>Number(config.massUpdateThreshold);
    const warnings=diff.filter(item=>item.warning).map(item=>({rowNumber:item.rowNumber,code:item.warning}));
    if(mass)warnings.push({code:'MASS_UPDATE_REVIEW_REQUIRED',changed:changed.length,current:currentCount});
    return {batchId:batch.id,items:diff,summary:{total:items.length,new:newCount,updated:existing.length,unchanged:existing.length-changed.length,priceChanges:changed.filter(item=>item.priceChanged).length,stockChanges:changed.filter(item=>item.stockChanged).length,unmatched:items.filter(item=>item.status==='UNMATCHED').length,invalid:items.filter(item=>['INVALID','DUPLICATE'].includes(item.status)).length},warnings,massUpdateReviewRequired:mass};
  }

  function updateStats(batchId,report,validationWarnings=[]){
    const items=listItems(batchId),invalid=items.filter(item=>['INVALID','DUPLICATE'].includes(item.status)).length,unmatched=items.filter(item=>item.status==='UNMATCHED').length,matched=items.filter(item=>['MATCHED','REVIEW_REQUIRED'].includes(item.status)).length,warnings=items.filter(item=>item.warnings.length>0).length;
    const diff=report||buildDiff(getBatch(batchId));const itemWarnings=items.flatMap(item=>item.warnings||[]).map(code=>({code}));const allWarnings=[...validationWarnings,...itemWarnings,...diff.warnings].filter((item,index,list)=>list.findIndex(value=>JSON.stringify(value)===JSON.stringify(item))===index);
    const status=invalid||unmatched||allWarnings.length?'REVIEW_REQUIRED':'READY_TO_PUBLISH';
    db.prepare(`UPDATE supplier_import_batches SET status=?,total_records=?,valid_records=?,invalid_records=?,warning_records=?,matched_records=?,unmatched_records=?,new_records=?,updated_records=?,unchanged_records=?,price_changes=?,stock_changes=?,errors_json=?,warnings_json=?,validated_at=? WHERE id=?`).run(status,items.length,items.length-invalid-unmatched,invalid,warnings,matched,unmatched,diff.summary.new,diff.summary.updated,diff.summary.unchanged,diff.summary.priceChanges,diff.summary.stockChanges,json(items.flatMap(item=>item.errors)),json(allWarnings),Date.now(),batchId);
    return getBatch(batchId);
  }

  function insertBatch({supplierId,sourceType,fileName,sourceHash,delimiter,decimalFormat,mapping,createdBy,status='RECEIVED',errors=[]}){
    if(!supplierRow(supplierId))throw fail('Fornecedor nao encontrado.',404);
    if(!['CSV','API'].includes(sourceType))throw fail('sourceType invalido.',422);
    const id='IMP-'+crypto.randomBytes(8).toString('hex').toUpperCase(),now=Date.now();
    db.prepare(`INSERT INTO supplier_import_batches(${batchColumns}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,supplierId,sourceType,fileName||null,sourceHash,status,delimiter||null,decimalFormat||null,json(mapping||{}),0,0,0,0,0,0,0,0,0,0,0,'[]',json(errors),now,createdBy||null,null,null,null);
    return id;
  }

  function previewCsv({supplierId,content,fileName,mapping={},delimiter,encoding='utf8',defaultCurrency,decimalFormat,now=Date.now()}){
    if(!supplierRow(supplierId))throw fail('Fornecedor nao encontrado.',404);
    const adapter=new CsvSupplierAdapter({mapping,defaultCurrency,decimalFormat});
    let parsed,items;
    try{const output=adapter.fetchCatalog(content,{delimiter,encoding,now});parsed=output.parsed;items=output.items;}catch(error){return {dryRun:true,sourceHash:ImportCore.hashSource(content),report:{total:0,valid:0,invalid:1,warnings:0,matched:0,unmatched:0,new:0,updated:0,unchanged:0,priceChanges:0,stockChanges:0,errors:[error.message],warnings:[]},items:[]};}
    const seen=new Set(),prepared=[];for(const item of items){const match=item.normalizedData.entityType==='KIT_OFFER'?matchKit(item.normalizedData):matchProduct(supplierId,item.normalizedData);const warnings=[...item.warnings];let status=item.status;if(item.errors.length===0){if(item.normalizedData.entityType==='KIT_OFFER'){item.normalizedData.kitId=match.kitId;if(!match.kitId)status='UNMATCHED';else status=match.warning?'REVIEW_REQUIRED':'MATCHED';}else{item.normalizedData.productId=match.productId;if(!match.productId)status='UNMATCHED';else status=match.warning?'REVIEW_REQUIRED':'MATCHED';}if(match.warning)warnings.push(match.warning);if(seen.has(`${item.normalizedData.entityType}:${item.externalSku}`)){item.errors.push('DUPLICATE_SKU');status='DUPLICATE';}seen.add(`${item.normalizedData.entityType}:${item.externalSku}`);}prepared.push({...item,status,warnings:[...new Set(warnings)],matchedProductId:item.normalizedData.productId||null,matchedKitId:item.normalizedData.kitId||null});}
    const report={total:prepared.length,valid:prepared.filter(item=>!['INVALID','DUPLICATE','UNMATCHED'].includes(item.status)).length,invalid:prepared.filter(item=>['INVALID','DUPLICATE'].includes(item.status)).length,warnings:prepared.filter(item=>item.warnings.length).length,matched:prepared.filter(item=>['MATCHED','REVIEW_REQUIRED'].includes(item.status)&&Boolean(item.matchedProductId||item.matchedKitId)).length,unmatched:prepared.filter(item=>item.status==='UNMATCHED').length,new:0,updated:0,unchanged:0,priceChanges:0,stockChanges:0,errors:prepared.flatMap(item=>item.errors),warningsList:prepared.flatMap(item=>item.warnings)};
    return {dryRun:true,sourceHash:ImportCore.hashSource(content),delimiter:parsed.delimiter,headers:parsed.headers,report,items:prepared};
  }

  function createCsvImport(input){
    const sourceHash=ImportCore.hashSource(input.content);const existing=db.prepare(`SELECT ${batchColumns} FROM supplier_import_batches WHERE supplier_id=? AND source_hash=?`).get(input.supplierId,sourceHash);if(existing)return {...normalizeStoredBatch(existing),idempotent:true};
    let parsed,items;const adapter=new CsvSupplierAdapter({mapping:input.mapping||{},defaultCurrency:input.defaultCurrency,decimalFormat:input.decimalFormat,logger});
    try{const output=adapter.fetchCatalog(input.content,{delimiter:input.delimiter,encoding:input.encoding||'utf8',now:input.now||Date.now()});parsed=output.parsed;items=output.items;}catch(error){const batchId=insertBatch({supplierId:input.supplierId,sourceType:'CSV',fileName:input.fileName,sourceHash,delimiter:input.delimiter,decimalFormat:input.decimalFormat,mapping:input.mapping,status:'FAILED',errors:[error.message],createdBy:input.createdBy});writeAudit(batchId,'SUPPLIER_IMPORT_FAILED',input.createdBy,{error:error.message});logger.warn?.({event:'SUPPLIER_IMPORT_FAILED',batchId,error:error.message});return getBatch(batchId);}
    const batchId=insertBatch({supplierId:input.supplierId,sourceType:'CSV',fileName:input.fileName,sourceHash,delimiter:parsed.delimiter,decimalFormat:input.decimalFormat,mapping:input.mapping,status:'VALIDATING',createdBy:input.createdBy});
    const insert=db.prepare(`INSERT INTO supplier_import_items(${itemColumns}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);const seen=new Set();
    try{
      db.exec('BEGIN IMMEDIATE');
      for(const rawItem of items){
        const match=rawItem.normalizedData.entityType==='KIT_OFFER'?matchKit(rawItem.normalizedData):matchProduct(input.supplierId,rawItem.normalizedData);const warnings=[...rawItem.warnings];let status=rawItem.status;
        if(rawItem.errors.length===0){if(rawItem.normalizedData.entityType==='KIT_OFFER'){rawItem.normalizedData.kitId=match.kitId;if(!match.kitId)status='UNMATCHED';else status=match.warning?'REVIEW_REQUIRED':'MATCHED';}else{rawItem.normalizedData.productId=match.productId;if(!match.productId)status='UNMATCHED';else status=match.warning?'REVIEW_REQUIRED':'MATCHED';}if(match.warning)warnings.push(match.warning);const key=`${rawItem.normalizedData.entityType}:${rawItem.externalSku}`;if(seen.has(key)){rawItem.errors.push('DUPLICATE_SKU');status='DUPLICATE';}seen.add(key);}
        const itemId='IMI-'+crypto.randomBytes(8).toString('hex').toUpperCase(),now=Date.now();insert.run(itemId,batchId,rawItem.rowNumber,rawItem.normalizedData.entityType,rawItem.externalSku,json(rawItem.rawData),rawItem.errors.length?null:json(rawItem.normalizedData),status,json(rawItem.errors),json([...new Set(warnings)]),rawItem.normalizedData.productId||null,rawItem.normalizedData.kitId||null,null,now,now);
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');db.prepare('UPDATE supplier_import_batches SET status=?,errors_json=?,validated_at=? WHERE id=?').run('FAILED',json([error.message]),Date.now(),batchId);writeAudit(batchId,'SUPPLIER_IMPORT_FAILED',input.createdBy,{error:error.message});logger.warn?.({event:'SUPPLIER_IMPORT_FAILED',batchId,error:error.message});return getBatch(batchId);}
    const report=buildDiff(getBatch(batchId));const updatedItems=listItems(batchId);
    for(const item of updatedItems){const diff=report.items.find(value=>value.rowNumber===item.rowNumber);const warnings=[...new Set([...item.warnings,...(diff?.warning?[diff.warning]:[])])];const terminal=['UNMATCHED','INVALID','DUPLICATE'].includes(item.status);if((warnings.length&&!terminal)||item.status==='MATCHED'&&item.normalizedData?.productId===null)db.prepare('UPDATE supplier_import_items SET status=?,warnings_json=?,updated_at=? WHERE id=?').run(warnings.length&&!terminal?'REVIEW_REQUIRED':item.status,json(warnings),Date.now(),item.id);}
    const final=updateStats(batchId,report);writeAudit(batchId,'SUPPLIER_IMPORT_VALIDATED',input.createdBy,{sourceHash,report:final});logger.info?.({event:'SUPPLIER_IMPORT_VALIDATED',batchId,status:final.status,totalRecords:final.totalRecords});if(final.status==='REVIEW_REQUIRED')logger.warn?.({event:'SUPPLIER_IMPORT_REVIEW_REQUIRED',batchId});return getFullBatch(batchId);
  }

  function getDiff(batchId){const batch=getBatch(batchId);if(!batch)throw fail('Importacao nao encontrada.',404);return buildDiff(batch);}
  function dryRun(batchId){return {...getDiff(batchId),dryRun:true,databaseWrites:0};}

  function ensureSupplierProduct(supplierId,data,now){
    let link=currentProductLink(supplierId,data.supplierSku);if(link)return link;
    const id='SP-'+crypto.createHash('sha256').update(`${supplierId}|${data.supplierSku}`).digest('hex').slice(0,24);db.prepare('INSERT INTO supplier_products(id,supplier_id,product_id,supplier_sku,supplier_name,supplier_url,active,last_sync_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,supplierId,data.productId,data.supplierSku,data.description||null,null,1,data.capturedAt||now,now,now);return currentProductLink(supplierId,data.supplierSku);
  }
  function ensureSupplierKit(supplierId,data,now){
    let link=currentKitLink(supplierId,data.kitSku);if(link)return link;
    const id='SK-'+crypto.createHash('sha256').update(`${supplierId}|${data.kitSku}`).digest('hex').slice(0,24);db.prepare('INSERT INTO supplier_kits(id,supplier_id,kit_id,supplier_sku,supplier_name,supplier_url,active,last_sync_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,supplierId,data.kitId,data.kitSku,data.kitName||null,null,1,data.capturedAt||now,now,now);return currentKitLink(supplierId,data.kitSku);
  }
  function publishProduct(supplierId,data,now){
    const link=ensureSupplierProduct(supplierId,data,now),current=productOffer(link.id),id=current?.id||'SO-'+crypto.createHash('sha256').update(`${supplierId}|${data.supplierSku}`).digest('hex').slice(0,24),same=current&&Number(current.price)===data.price&&current.currency===data.currency&&normalizedStock(current.stock_status)===data.stockStatus&&Number(current.stock_quantity??-1)===Number(data.stockQuantity??-1)&&Number(current.lead_time_days??-1)===Number(data.leadTimeDays??-1)&&Number(current.valid_until??-1)===Number(data.validUntil??-1);
    db.prepare('UPDATE supplier_products SET product_id=?,supplier_name=?,active=1,last_sync_at=?,updated_at=? WHERE id=?').run(data.productId,data.description||null,data.capturedAt||now,now,link.id);
    db.prepare(`INSERT INTO supplier_offers(id,supplier_product_id,price,currency,stock_status,stock_quantity,lead_time_days,valid_until,captured_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET price=excluded.price,currency=excluded.currency,stock_status=excluded.stock_status,stock_quantity=excluded.stock_quantity,lead_time_days=excluded.lead_time_days,valid_until=excluded.valid_until,captured_at=excluded.captured_at,updated_at=excluded.updated_at`).run(id,link.id,data.price,data.currency,data.stockStatus,data.stockQuantity,data.leadTimeDays,data.validUntil,data.capturedAt||now, current?.created_at||now,now);
    if(!same&&(!current||Number(current.price)!==data.price))db.prepare('INSERT INTO price_history(id,supplier_product_id,supplier_kit_id,price,currency,captured_at) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),link.id,null,data.price,data.currency,data.capturedAt||now);
    return {entityId:id,linkId:link.id,changed:!same};
  }
  function publishKit(supplierId,data,now){
    const link=ensureSupplierKit(supplierId,data,now),current=kitOffer(link.id),id=current?.id||'SKO-'+crypto.createHash('sha256').update(`${supplierId}|${data.kitSku}`).digest('hex').slice(0,24),same=current&&Number(current.price)===data.price&&current.currency===data.currency&&current.stock_status===data.stockStatus&&Number(current.stock_quantity??-1)===Number(data.stockQuantity??-1)&&Number(current.lead_time_days??-1)===Number(data.leadTimeDays??-1)&&Number(current.valid_until??-1)===Number(data.validUntil??-1);
    db.prepare('UPDATE supplier_kits SET kit_id=?,supplier_name=?,active=1,last_sync_at=?,updated_at=? WHERE id=?').run(data.kitId,data.kitName||null,data.capturedAt||now,now,link.id);
    db.prepare(`INSERT INTO supplier_kit_offers(id,supplier_kit_id,price,currency,stock_status,stock_quantity,lead_time_days,valid_until,captured_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET price=excluded.price,currency=excluded.currency,stock_status=excluded.stock_status,stock_quantity=excluded.stock_quantity,lead_time_days=excluded.lead_time_days,valid_until=excluded.valid_until,captured_at=excluded.captured_at,updated_at=excluded.updated_at`).run(id,link.id,data.price,data.currency,data.stockStatus,data.stockQuantity,data.leadTimeDays,data.validUntil,data.capturedAt||now,current?.created_at||now,now);
    if(!same&&(!current||Number(current.price)!==data.price))db.prepare('INSERT INTO price_history(id,supplier_product_id,supplier_kit_id,price,currency,captured_at) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),null,link.id,data.price,data.currency,data.capturedAt||now);
    return {entityId:id,linkId:link.id,changed:!same};
  }

  function publish(batchId,{actorId,confirmReview=false}={}){
    const batch=getBatch(batchId);if(!batch)throw fail('Importacao nao encontrada.',404);if(['PUBLISHED','CANCELLED','FAILED'].includes(batch.status))throw fail('Lifecycle do import nao permite publicacao.',409);
    const items=listItems(batchId),invalid=items.filter(item=>['INVALID','DUPLICATE','UNMATCHED'].includes(item.status));if(invalid.length)throw fail('Importacao possui itens invalidos ou sem correspondencia.',422);
    const diff=getDiff(batchId);if((batch.status==='REVIEW_REQUIRED'||diff.warnings.length)&&confirmReview!==true)throw fail('Importacao exige revisao explicita antes da publicacao.',422);
    const supplierId=batch.supplierId,now=Date.now();let published=0,changed=0;
    try{
      db.exec('BEGIN IMMEDIATE');
      for(const item of items){const data=clone(item.normalizedData);const output=item.entityType==='KIT_OFFER'?publishKit(supplierId,data,now):publishProduct(supplierId,data,now);db.prepare('UPDATE supplier_import_items SET status=?,published_entity_id=?,updated_at=? WHERE id=?').run('PUBLISHED',output.entityId,now,item.id);published++;if(output.changed)changed++;}
      db.prepare('UPDATE supplier_import_batches SET status=?,published_at=?,published_by=? WHERE id=?').run('PUBLISHED',now,actorId||null,batchId);writeAudit(batchId,'SUPPLIER_IMPORT_PUBLISHED',actorId,{published,changed});db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');logger.warn?.({event:'SUPPLIER_IMPORT_FAILED',batchId,error:error.message});throw fail('Publicacao revertida integralmente: '+error.message,500);}
    logger.info?.({event:'SUPPLIER_IMPORT_PUBLISHED',batchId,published,changed});return getBatch(batchId);
  }

  function cancel(batchId,actorId){const batch=getBatch(batchId);if(!batch)throw fail('Importacao nao encontrada.',404);if(['PUBLISHED','CANCELLED'].includes(batch.status))throw fail('Importacao nao pode ser cancelada.',409);db.prepare('UPDATE supplier_import_batches SET status=? WHERE id=?').run('CANCELLED',batchId);writeAudit(batchId,'SUPPLIER_IMPORT_CANCELLED',actorId);logger.info?.({event:'SUPPLIER_IMPORT_CANCELLED',batchId});return getBatch(batchId);}

  function reviewItem(batchId,itemId,{productId,kitId,actorId}={}){
    const batch=getBatch(batchId),item=getItem(itemId);if(!batch||!item||item.batchId!==batchId)throw fail('Item de importacao nao encontrado.',404);if(batch.status==='PUBLISHED')throw fail('Importacao publicada nao pode ser revisada.',409);
    if(item.entityType==='PRODUCT_OFFER'){
      if(!productId||!productRow(productId))throw fail('Produto para correspondencia nao encontrado.',422);item.normalizedData.productId=productId;item.status='MATCHED';item.warnings=(item.warnings||[]).filter(w=>w!=='PRODUCT_UNMATCHED');db.prepare('UPDATE supplier_import_items SET normalized_data_json=?,status=?,matched_product_id=?,warnings_json=?,updated_at=? WHERE id=?').run(json(item.normalizedData),item.status,productId,json(item.warnings),Date.now(),itemId);
    }else{
      if(!kitId||!kitRow(kitId))throw fail('Kit para correspondencia nao encontrado.',422);item.normalizedData.kitId=kitId;item.status='MATCHED';item.warnings=(item.warnings||[]).filter(w=>w!=='KIT_UNMATCHED');db.prepare('UPDATE supplier_import_items SET normalized_data_json=?,status=?,matched_kit_id=?,warnings_json=?,updated_at=? WHERE id=?').run(json(item.normalizedData),item.status,kitId,json(item.warnings),Date.now(),itemId);
    }
    writeAudit(batchId,'SUPPLIER_IMPORT_ITEM_REVIEWED',actorId,{itemId,productId:productId||null,kitId:kitId||null});return updateStats(batchId,buildDiff(getBatch(batchId)));
  }

  function getFullBatch(id){const batch=getBatch(id);if(!batch)return null;return {...batch,items:listItems(id),audit:audit(id),diff:buildDiff(batch)};}
  return {listBatches,getBatch:getFullBatch,listItems,previewCsv,createCsvImport,getDiff,dryRun,publish,cancel,reviewItem,constants:{BATCH_STATUSES,ITEM_STATUSES,config}};
}

module.exports={createSupplierImportService,BATCH_STATUSES,ITEM_STATUSES,normalizeStoredBatch,normalizeStoredItem};
