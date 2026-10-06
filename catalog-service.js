const Core=require('./catalog-core');

const supplierColumns='id,name,slug,active,integration_type,created_at,updated_at';
const productColumns='id,category,manufacturer,model,description,specifications_json,active,created_at,updated_at';
const supplierProductColumns='id,supplier_id,product_id,supplier_sku,supplier_name,supplier_url,active,last_sync_at,created_at,updated_at';
const offerColumns='id,supplier_product_id,price,currency,stock_status,stock_quantity,lead_time_days,valid_until,captured_at,created_at,updated_at';
const priceHistoryColumns='id,supplier_product_id,supplier_kit_id,price,currency,captured_at';

const supplierFromRow=row=>row&&({id:row.id,name:row.name,slug:row.slug,active:!!row.active,integrationType:row.integration_type,createdAt:row.created_at,updatedAt:row.updated_at});
const productFromRow=row=>row&&({id:row.id,category:row.category,manufacturer:row.manufacturer,model:row.model,description:row.description,specifications:JSON.parse(row.specifications_json),active:!!row.active,createdAt:row.created_at,updatedAt:row.updated_at});
const supplierProductFromRow=row=>row&&({id:row.id,supplierId:row.supplier_id,productId:row.product_id,supplierSku:row.supplier_sku,supplierName:row.supplier_name,supplierUrl:row.supplier_url,active:!!row.active,lastSyncAt:row.last_sync_at,createdAt:row.created_at,updatedAt:row.updated_at});
const offerFromRow=row=>row&&({id:row.id,supplierProductId:row.supplier_product_id,price:row.price===null?null:Number(row.price),currency:row.currency,stockStatus:row.stock_status,stockQuantity:row.stock_quantity===null?null:Number(row.stock_quantity),leadTimeDays:row.lead_time_days===null?null:Number(row.lead_time_days),validUntil:row.valid_until,capturedAt:row.captured_at,createdAt:row.created_at,updatedAt:row.updated_at});
const priceHistoryFromRow=row=>row&&({id:row.id,supplierProductId:row.supplier_product_id,supplierKitId:row.supplier_kit_id,price:Number(row.price),currency:row.currency,capturedAt:row.captured_at});

function createCatalogService(db){
  const getSupplier=id=>supplierFromRow(db.prepare(`SELECT ${supplierColumns} FROM suppliers WHERE id=?`).get(id));
  const getProduct=id=>productFromRow(db.prepare(`SELECT ${productColumns} FROM products WHERE id=?`).get(id));
  const getSupplierProduct=id=>supplierProductFromRow(db.prepare(`SELECT ${supplierProductColumns} FROM supplier_products WHERE id=?`).get(id));
  const getOffer=id=>offerFromRow(db.prepare(`SELECT ${offerColumns} FROM supplier_offers WHERE id=?`).get(id));

  function createSupplier(input){
    const value=Core.normalizeSupplier(input);
    db.prepare('INSERT INTO suppliers('+supplierColumns+') VALUES (?,?,?,?,?,?,?)').run(value.id,value.name,value.slug,value.active?1:0,value.integrationType,value.createdAt,value.updatedAt);
    return getSupplier(value.id);
  }

  function updateSupplier(id,patch){
    const current=getSupplier(id);if(!current)throw new Error('Fornecedor não encontrado.');
    const value=Core.normalizeSupplier({...current,...patch,id,createdAt:current.createdAt,updatedAt:Date.now()});
    db.prepare('UPDATE suppliers SET name=?,slug=?,active=?,integration_type=?,updated_at=? WHERE id=?').run(value.name,value.slug,value.active?1:0,value.integrationType,value.updatedAt,id);
    return getSupplier(id);
  }

  function createProduct(input){
    const value=Core.normalizeProduct(input);
    db.prepare('INSERT INTO products('+productColumns+') VALUES (?,?,?,?,?,?,?,?,?)').run(value.id,value.category,value.manufacturer,value.model,value.description,JSON.stringify(value.specifications),value.active?1:0,value.createdAt,value.updatedAt);
    return getProduct(value.id);
  }

  function updateProduct(id,patch){
    const current=getProduct(id);if(!current)throw new Error('Produto não encontrado.');
    const value=Core.normalizeProduct({...current,...patch,id,createdAt:current.createdAt,updatedAt:Date.now()});
    db.prepare('UPDATE products SET category=?,manufacturer=?,model=?,description=?,specifications_json=?,active=?,updated_at=? WHERE id=?').run(value.category,value.manufacturer,value.model,value.description,JSON.stringify(value.specifications),value.active?1:0,value.updatedAt,id);
    return getProduct(id);
  }

  function linkSupplierProduct(input){
    const value=Core.normalizeSupplierProduct(input);
    if(!getSupplier(value.supplierId))throw new Error('Fornecedor não encontrado.');
    if(!getProduct(value.productId))throw new Error('Produto não encontrado.');
    db.prepare('INSERT INTO supplier_products('+supplierProductColumns+') VALUES (?,?,?,?,?,?,?,?,?,?)').run(value.id,value.supplierId,value.productId,value.supplierSku,value.supplierName,value.supplierUrl,value.active?1:0,value.lastSyncAt,value.createdAt,value.updatedAt);
    return getSupplierProduct(value.id);
  }

  function updateSupplierProduct(id,patch){
    const current=getSupplierProduct(id);if(!current)throw new Error('Vínculo fornecedor-produto não encontrado.');
    const value=Core.normalizeSupplierProduct({...current,...patch,id,createdAt:current.createdAt,updatedAt:Date.now()});
    if(!getSupplier(value.supplierId))throw new Error('Fornecedor não encontrado.');
    if(!getProduct(value.productId))throw new Error('Produto não encontrado.');
    db.prepare('UPDATE supplier_products SET supplier_id=?,product_id=?,supplier_sku=?,supplier_name=?,supplier_url=?,active=?,last_sync_at=?,updated_at=? WHERE id=?').run(value.supplierId,value.productId,value.supplierSku,value.supplierName,value.supplierUrl,value.active?1:0,value.lastSyncAt,value.updatedAt,id);
    return getSupplierProduct(id);
  }

  function recordPrice(value){
    const history=Core.normalizePriceHistory(value);
    db.prepare('INSERT INTO price_history('+priceHistoryColumns+') VALUES (?,?,?,?,?,?)').run(history.id,history.supplierProductId,history.supplierKitId,history.price,history.currency,history.capturedAt);
    return priceHistoryFromRow(db.prepare(`SELECT ${priceHistoryColumns} FROM price_history WHERE id=?`).get(history.id));
  }

  function createOffer(input){
    const value=Core.normalizeSupplierOffer(input);
    if(!getSupplierProduct(value.supplierProductId))throw new Error('Produto do fornecedor não encontrado.');
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('INSERT INTO supplier_offers('+offerColumns+') VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(value.id,value.supplierProductId,value.price,value.currency,value.stockStatus,value.stockQuantity,value.leadTimeDays,value.validUntil,value.capturedAt,value.createdAt,value.updatedAt);
      if(value.price!==null)recordPrice({supplierProductId:value.supplierProductId,price:value.price,currency:value.currency,capturedAt:value.capturedAt});
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return getOffer(value.id);
  }

  function updateOffer(id,patch){
    const current=getOffer(id);if(!current)throw new Error('Oferta não encontrada.');
    const value=Core.normalizeSupplierOffer({...current,...patch,id,createdAt:current.createdAt,updatedAt:Date.now()});
    if(!getSupplierProduct(value.supplierProductId))throw new Error('Produto do fornecedor não encontrado.');
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('UPDATE supplier_offers SET supplier_product_id=?,price=?,currency=?,stock_status=?,stock_quantity=?,lead_time_days=?,valid_until=?,captured_at=?,updated_at=? WHERE id=?').run(value.supplierProductId,value.price,value.currency,value.stockStatus,value.stockQuantity,value.leadTimeDays,value.validUntil,value.capturedAt,value.updatedAt,id);
      if(value.price!==null&&value.price!==current.price)recordPrice({supplierProductId:value.supplierProductId,price:value.price,currency:value.currency,capturedAt:value.capturedAt});
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return getOffer(id);
  }

  return {
    createSupplier,updateSupplier,getSupplier,
    createProduct,updateProduct,getProduct,
    linkSupplierProduct,updateSupplierProduct,getSupplierProduct,
    createOffer,updateOffer,getOffer,recordPrice,
    listSuppliers:()=>db.prepare(`SELECT ${supplierColumns} FROM suppliers ORDER BY name,id`).all().map(supplierFromRow),
    findSupplierBySlug:slug=>supplierFromRow(db.prepare(`SELECT ${supplierColumns} FROM suppliers WHERE slug=?`).get(slug)),
    findProduct:(category,manufacturer,model)=>productFromRow(db.prepare(`SELECT ${productColumns} FROM products WHERE category=? AND manufacturer=? AND model=?`).get(category,manufacturer,model)),
    listPriceHistory:supplierProductId=>db.prepare(`SELECT ${priceHistoryColumns} FROM price_history WHERE supplier_product_id=? ORDER BY captured_at,id`).all(supplierProductId).map(priceHistoryFromRow)
  };
}

module.exports={createCatalogService};
