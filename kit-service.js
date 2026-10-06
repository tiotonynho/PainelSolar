const Core=require('./catalog-core');
const KitCore=require('./kit-core');
const {createCatalogService}=require('./catalog-service');

const kitColumns='id,name,slug,nominal_power_wp,phase_type,voltage,roof_type,description,active,created_at,updated_at';
const kitItemColumns='id,kit_id,product_id,quantity,role,created_at,updated_at';
const supplierKitColumns='id,supplier_id,kit_id,supplier_sku,supplier_name,supplier_url,active,last_sync_at,created_at,updated_at';
const supplierKitOfferColumns='id,supplier_kit_id,price,currency,stock_status,stock_quantity,lead_time_days,valid_until,captured_at,created_at,updated_at';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const kitFromRow=row=>row&&({id:row.id,name:row.name,slug:row.slug,nominalPowerWp:Number(row.nominal_power_wp),phaseType:row.phase_type,voltage:row.voltage,roofType:row.roof_type,description:row.description,active:!!row.active,createdAt:row.created_at,updatedAt:row.updated_at});
const itemFromRow=row=>row&&({id:row.id,kitId:row.kit_id,productId:row.product_id,quantity:Number(row.quantity),role:row.role,createdAt:row.created_at,updatedAt:row.updated_at});
const productFromJoin=row=>row&&({id:row.product_id,category:row.product_category,manufacturer:row.product_manufacturer,model:row.product_model,description:row.product_description,specifications:JSON.parse(row.product_specifications_json),active:!!row.product_active,createdAt:row.product_created_at,updatedAt:row.product_updated_at});
const supplierKitFromRow=row=>row&&({id:row.id,supplierId:row.supplier_id,kitId:row.kit_id,supplierSku:row.supplier_sku,supplierName:row.supplier_name,supplierUrl:row.supplier_url,active:!!row.active,lastSyncAt:row.last_sync_at,createdAt:row.created_at,updatedAt:row.updated_at,supplier:row.supplier_ref_id?{id:row.supplier_ref_id,name:row.supplier_ref_name,slug:row.supplier_ref_slug,active:!!row.supplier_ref_active}:null});
const offerFromRow=row=>row&&({id:row.id,supplierKitId:row.supplier_kit_id,price:row.price===null?null:Number(row.price),currency:row.currency,stockStatus:row.stock_status,stockQuantity:row.stock_quantity===null?null:Number(row.stock_quantity),leadTimeDays:row.lead_time_days===null?null:Number(row.lead_time_days),validUntil:row.valid_until,capturedAt:row.captured_at,createdAt:row.created_at,updatedAt:row.updated_at});

function createKitService(db){
  const catalog=createCatalogService(db);
  const getKitBase=id=>kitFromRow(db.prepare(`SELECT ${kitColumns} FROM kits WHERE id=?`).get(id));
  const getKitItemBase=id=>itemFromRow(db.prepare(`SELECT ${kitItemColumns} FROM kit_items WHERE id=?`).get(id));
  const getSupplierKitBase=id=>supplierKitFromRow(db.prepare(`SELECT sk.${supplierKitColumns.replaceAll(',',',sk.')} , s.id AS supplier_ref_id, s.name AS supplier_ref_name, s.slug AS supplier_ref_slug, s.active AS supplier_ref_active FROM supplier_kits sk JOIN suppliers s ON s.id=sk.supplier_id WHERE sk.id=?`).get(id));
  const getSupplierKitOffer=id=>offerFromRow(db.prepare(`SELECT ${supplierKitOfferColumns} FROM supplier_kit_offers WHERE id=?`).get(id));

  function kitItems(kitId){
    const rows=db.prepare(`SELECT ki.id,ki.kit_id,ki.product_id,ki.quantity,ki.role,ki.created_at,ki.updated_at,
      p.category AS product_category,p.manufacturer AS product_manufacturer,p.model AS product_model,
      p.description AS product_description,p.specifications_json AS product_specifications_json,
      p.active AS product_active,p.created_at AS product_created_at,p.updated_at AS product_updated_at
      FROM kit_items ki JOIN products p ON p.id=ki.product_id WHERE ki.kit_id=? ORDER BY ki.created_at,ki.id`).all(kitId);
    return rows.map(row=>({...itemFromRow(row),product:productFromJoin(row)}));
  }

  function supplierKitOffers(supplierKitId){
    return db.prepare(`SELECT ${supplierKitOfferColumns} FROM supplier_kit_offers WHERE supplier_kit_id=? ORDER BY captured_at DESC,id DESC`).all(supplierKitId).map(offerFromRow);
  }

  function getSupplierKit(id){
    const value=getSupplierKitBase(id);if(!value)return null;
    return {...value,offers:supplierKitOffers(id)};
  }

  function supplierKits(kitId){
    const ids=db.prepare('SELECT id FROM supplier_kits WHERE kit_id=? ORDER BY created_at,id').all(kitId).map(row=>row.id);
    return ids.map(getSupplierKit);
  }

  function validationFor(kit,items){
    return KitCore.validateKit(kit,items,items.map(item=>item.product));
  }

  function assertValid(kit,items){
    const validation=validationFor(kit,items);
    if(!validation.valid)throw fail(validation.errors.join(' '));
    return validation;
  }

  function getKit(id){
    const kit=getKitBase(id);if(!kit)return null;
    const items=kitItems(id);
    const validation=validationFor(kit,items);
    return {...kit,items,supplierKits:supplierKits(id),calculatedModulePowerWp:validation.calculatedModulePowerWp,validation};
  }

  function listKits(){
    return db.prepare('SELECT id FROM kits ORDER BY name,id').all().map(row=>getKit(row.id));
  }

  function listKitsForMatching(){
    const rows=db.prepare(`SELECT k.id,k.name,k.slug,k.nominal_power_wp,k.phase_type,k.voltage,k.roof_type,k.description,k.active,k.created_at,k.updated_at,
      ki.id AS item_id,ki.kit_id AS item_kit_id,ki.product_id AS item_product_id,ki.quantity AS item_quantity,ki.role AS item_role,
      ki.created_at AS item_created_at,ki.updated_at AS item_updated_at,
      p.id AS product_id,p.category AS product_category,p.manufacturer AS product_manufacturer,p.model AS product_model,
      p.description AS product_description,p.specifications_json AS product_specifications_json,
      p.active AS product_active,p.created_at AS product_created_at,p.updated_at AS product_updated_at
      FROM kits k
      LEFT JOIN kit_items ki ON ki.kit_id=k.id
      LEFT JOIN products p ON p.id=ki.product_id
      ORDER BY k.name,k.id,ki.created_at,ki.id`).all();
    const byId=new Map();
    for(const row of rows){
      if(!byId.has(row.id))byId.set(row.id,{...kitFromRow(row),items:[]});
      if(row.item_id!==null){
        const item={
          id:row.item_id,kitId:row.item_kit_id,productId:row.item_product_id,quantity:Number(row.item_quantity),role:row.item_role,
          createdAt:row.item_created_at,updatedAt:row.item_updated_at,
          product:row.product_id?productFromJoin(row):null
        };
        byId.get(row.id).items.push(item);
      }
    }
    return [...byId.values()].map(kit=>{
      const validation=validationFor(kit,kit.items);
      return {...kit,calculatedModulePowerWp:validation.calculatedModulePowerWp,validation};
    });
  }

  function createKit(input){
    const value=KitCore.normalizeKit(input);
    assertValid(value,[]);
    db.prepare('INSERT INTO kits('+kitColumns+') VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(value.id,value.name,value.slug,value.nominalPowerWp,value.phaseType,value.voltage,value.roofType,value.description,value.active?1:0,value.createdAt,value.updatedAt);
    return getKit(value.id);
  }

  function updateKit(id,patch){
    const current=getKitBase(id);if(!current)throw fail('Kit não encontrado.',404);
    const value=KitCore.normalizeKit({...current,...patch,id,createdAt:current.createdAt,updatedAt:Date.now()});
    const items=kitItems(id);
    assertValid(value,items);
    db.prepare('UPDATE kits SET name=?,slug=?,nominal_power_wp=?,phase_type=?,voltage=?,roof_type=?,description=?,active=?,updated_at=? WHERE id=?').run(value.name,value.slug,value.nominalPowerWp,value.phaseType,value.voltage,value.roofType,value.description,value.active?1:0,value.updatedAt,id);
    return getKit(id);
  }

  function addKitItem(kitId,input){
    const kit=getKitBase(kitId);if(!kit)throw fail('Kit não encontrado.',404);
    if(!catalog.getProduct(input.productId))throw fail('Produto não encontrado.',404);
    const value=KitCore.normalizeKitItem({...input,kitId});
    if(db.prepare('SELECT id FROM kit_items WHERE kit_id=? AND product_id=? AND role=?').get(kitId,value.productId,value.role))throw fail('Este produto e papel já existem no kit.',409);
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('INSERT INTO kit_items('+kitItemColumns+') VALUES (?,?,?,?,?,?,?)').run(value.id,value.kitId,value.productId,value.quantity,value.role,value.createdAt,value.updatedAt);
      assertValid(kit,kitItems(kitId));
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return getKit(kitId).items.find(item=>item.id===value.id);
  }

  function removeKitItem(kitId,itemId){
    const kit=getKitBase(kitId);if(!kit)throw fail('Kit não encontrado.',404);
    if(!getKitItemBase(itemId)||getKitItemBase(itemId).kitId!==kitId)throw fail('Item do kit não encontrado.',404);
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('DELETE FROM kit_items WHERE id=? AND kit_id=?').run(itemId,kitId);
      assertValid(kit,kitItems(kitId));
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return getKit(kitId);
  }

  function validateKit(id){
    const kit=getKit(id);if(!kit)throw fail('Kit não encontrado.',404);
    return kit.validation;
  }

  function calculateDcPower(id){
    const kit=getKit(id);if(!kit)throw fail('Kit não encontrado.',404);
    return KitCore.calculateDcPower(kit.items,kit.items.map(item=>item.product));
  }

  function findKitBySlug(slug){
    const row=db.prepare('SELECT id FROM kits WHERE slug=?').get(slug);
    return row?getKit(row.id):null;
  }

  function createSupplierKit(input){
    const value=KitCore.normalizeSupplierKit(input);
    if(!catalog.getSupplier(value.supplierId))throw fail('Fornecedor não encontrado.',404);
    if(!getKitBase(value.kitId))throw fail('Kit não encontrado.',404);
    db.prepare('INSERT INTO supplier_kits('+supplierKitColumns+') VALUES (?,?,?,?,?,?,?,?,?,?)').run(value.id,value.supplierId,value.kitId,value.supplierSku,value.supplierName,value.supplierUrl,value.active?1:0,value.lastSyncAt,value.createdAt,value.updatedAt);
    return getSupplierKit(value.id);
  }

  function updateSupplierKit(id,patch){
    const current=getSupplierKitBase(id);if(!current)throw fail('Kit do fornecedor não encontrado.',404);
    const value=KitCore.normalizeSupplierKit({...current,...patch,id,createdAt:current.createdAt,updatedAt:Date.now()});
    if(!catalog.getSupplier(value.supplierId))throw fail('Fornecedor não encontrado.',404);
    if(!getKitBase(value.kitId))throw fail('Kit não encontrado.',404);
    db.prepare('UPDATE supplier_kits SET supplier_id=?,kit_id=?,supplier_sku=?,supplier_name=?,supplier_url=?,active=?,last_sync_at=?,updated_at=? WHERE id=?').run(value.supplierId,value.kitId,value.supplierSku,value.supplierName,value.supplierUrl,value.active?1:0,value.lastSyncAt,value.updatedAt,id);
    return getSupplierKit(id);
  }

  function createSupplierKitOffer(input){
    const value=KitCore.normalizeSupplierKitOffer(input);
    if(!getSupplierKitBase(value.supplierKitId))throw fail('Kit do fornecedor não encontrado.',404);
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('INSERT INTO supplier_kit_offers('+supplierKitOfferColumns+') VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(value.id,value.supplierKitId,value.price,value.currency,value.stockStatus,value.stockQuantity,value.leadTimeDays,value.validUntil,value.capturedAt,value.createdAt,value.updatedAt);
      if(value.price!==null)catalog.recordPrice({supplierKitId:value.supplierKitId,price:value.price,currency:value.currency,capturedAt:value.capturedAt});
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return getSupplierKitOffer(value.id);
  }

  function updateSupplierKitOffer(id,patch){
    const current=getSupplierKitOffer(id);if(!current)throw fail('Oferta do kit não encontrada.',404);
    const value=KitCore.normalizeSupplierKitOffer({...current,...patch,id,createdAt:current.createdAt,updatedAt:Date.now()});
    if(!getSupplierKitBase(value.supplierKitId))throw fail('Kit do fornecedor não encontrado.',404);
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('UPDATE supplier_kit_offers SET supplier_kit_id=?,price=?,currency=?,stock_status=?,stock_quantity=?,lead_time_days=?,valid_until=?,captured_at=?,updated_at=? WHERE id=?').run(value.supplierKitId,value.price,value.currency,value.stockStatus,value.stockQuantity,value.leadTimeDays,value.validUntil,value.capturedAt,value.updatedAt,id);
      if(value.price!==null&&value.price!==current.price)catalog.recordPrice({supplierKitId:value.supplierKitId,price:value.price,currency:value.currency,capturedAt:value.capturedAt});
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return getSupplierKitOffer(id);
  }

  return {
    createKit,updateKit,addKitItem,removeKitItem,getKit,listKits,listKitsForMatching,validateKit,calculateDcPower,findKitBySlug,
    createSupplierKit,updateSupplierKit,getSupplierKit,createSupplierKitOffer,updateSupplierKitOffer,getSupplierKitOffer
  };
}

module.exports={createKitService};
