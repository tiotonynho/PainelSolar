const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {openDatabase}=require('../db');
const {createCatalogService}=require('../catalog-service');
const {seedDevelopmentCatalog}=require('../catalog-seed');
const {normalizeProduct}=require('../catalog-core');

function tempDir(prefix){
  const dir=path.join(__dirname,'../tmp',prefix+'-'+crypto.randomUUID());
  fs.mkdirSync(dir,{recursive:true});
  return dir;
}

test('migration de catálogo preserva o banco legado e é idempotente',()=>{
  const dir=tempDir('catalog-migration');
  const legacy=new DatabaseSync(path.join(dir,'contracts.sqlite'));
  legacy.exec('CREATE TABLE records(id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  legacy.prepare('INSERT INTO records VALUES (?,?)').run('PT-LEGACY','{}');
  legacy.close();

  let db=openDatabase(dir);
  assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n,5);
  for(const table of ['suppliers','products','supplier_products','supplier_offers','price_history','kits','kit_items','supplier_kits','supplier_kit_offers','commercial_configs','commercial_config_audit','supplier_import_batches','supplier_import_items','supplier_import_audit','campaign_diagnostic_config','campaign_diagnostics','campaign_diagnostic_attachments','campaign_diagnostic_history']){
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n,1);
  }
  db.close();

  db=openDatabase(dir);
  assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n,5);
  assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n,1);
  db.close();
});

test('migration 002 preserva histórico de preço de produto da etapa 1',()=>{
  const dir=tempDir('catalog-price-migration');
  const legacy=new DatabaseSync(path.join(dir,'contracts.sqlite'));
  legacy.exec(fs.readFileSync(path.join(__dirname,'../migrations/001_catalog_core.sql'),'utf8'));
  legacy.exec('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  legacy.prepare('INSERT INTO schema_migrations VALUES (?,?)').run('001_catalog_core.sql',100);
  legacy.prepare('INSERT INTO suppliers(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)').run('SUP-LEGACY','Legacy Supplier','legacy-supplier',100,100);
  legacy.prepare('INSERT INTO products(id,category,manufacturer,model,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('PROD-LEGACY','MODULE','DEV','Legacy Module',100,100);
  legacy.prepare('INSERT INTO supplier_products(id,supplier_id,product_id,supplier_sku,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('SP-LEGACY','SUP-LEGACY','PROD-LEGACY','LEGACY-001',100,100);
  legacy.prepare('INSERT INTO price_history(id,supplier_product_id,price,currency,captured_at) VALUES (?,?,?,?,?)').run('PH-LEGACY','SP-LEGACY',321,'BRL',200);
  legacy.close();
  const db=openDatabase(dir);
  const row=db.prepare('SELECT id,supplier_product_id,supplier_kit_id,price,captured_at FROM price_history WHERE id=?').get('PH-LEGACY');
  assert.equal(row.id,'PH-LEGACY');
  assert.equal(row.supplier_product_id,'SP-LEGACY');
  assert.equal(row.supplier_kit_id,null);
  assert.equal(row.price,321);
  assert.equal(row.captured_at,200);
  db.close();
});

test('catálogo normaliza entidades e mantém separação entre produto e oferta',()=>{
  const db=openDatabase(tempDir('catalog-domain'));
  const service=createCatalogService(db);
  const supplier=service.createSupplier({id:'SUP-ALDO',name:'Aldo Solar',slug:'Aldo Solar',integrationType:'csv',createdAt:100,updatedAt:100});
  const product=service.createProduct({id:'PROD-DEV610',category:'MODULE',manufacturer:'DEV',model:'DEV Module 610W',specifications:{powerWp:610},createdAt:100,updatedAt:100});
  const supplierProduct=service.linkSupplierProduct({id:'SP-001',supplierId:supplier.id,productId:product.id,supplierSku:'DEV001',supplierName:'Módulo de desenvolvimento',createdAt:100,updatedAt:100});
  const offer=service.createOffer({id:'OFF-001',supplierProductId:supplierProduct.id,price:1234.5,currency:'brl',stockStatus:'IN_STOCK',stockQuantity:10,leadTimeDays:3,capturedAt:200,createdAt:200,updatedAt:200});

  assert.equal(supplier.slug,'aldo-solar');
  assert.equal(product.specifications.powerWp,610);
  assert.equal(supplierProduct.supplierSku,'DEV001');
  assert.equal(offer.price,1234.5);
  assert.equal(db.prepare('SELECT count(*) AS n FROM price_history WHERE supplier_product_id=?').get(supplierProduct.id).n,1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_table_info('products') WHERE name='price'").get().n,0);
  db.close();
});

test('atualização de oferta registra somente nova captura de preço e preserva histórico',()=>{
  const db=openDatabase(tempDir('catalog-history'));
  const service=createCatalogService(db);
  const supplier=service.createSupplier({id:'SUP-1',name:'Fornecedor',slug:'fornecedor'});
  const product=service.createProduct({id:'PROD-1',category:'INVERTER',manufacturer:'DEV',model:'DEV Inverter 5kW'});
  const supplierProduct=service.linkSupplierProduct({id:'SP-1',supplierId:supplier.id,productId:product.id,supplierSku:'SKU-1'});
  const offer=service.createOffer({id:'OFF-1',supplierProductId:supplierProduct.id,price:1000,capturedAt:1000});
  service.updateOffer(offer.id,{price:1000,stockQuantity:5,capturedAt:1100});
  service.updateOffer(offer.id,{price:950,stockQuantity:4,capturedAt:1200});
  assert.deepEqual(service.listPriceHistory(supplierProduct.id).map(item=>[item.price,item.capturedAt]),[[1000,1000],[950,1200]]);
  assert.equal(service.getOffer(offer.id).stockQuantity,4);
  db.close();
});

test('foreign keys e validação impedem referências inválidas',()=>{
  const db=openDatabase(tempDir('catalog-constraints'));
  const service=createCatalogService(db);
  assert.throws(()=>service.createProduct({id:'BAD',category:'UNKNOWN',manufacturer:'DEV',model:'Invalid'}),/Categoria de produto inválida/);
  assert.throws(()=>service.linkSupplierProduct({id:'SP-BAD',supplierId:'MISSING',productId:'MISSING',supplierSku:'SKU'}),/Fornecedor não encontrado/);
  assert.throws(()=>normalizeProduct({id:'BAD',category:'MODULE',manufacturer:'DEV',model:'Invalid',specifications:'not-json'}),/JSON válido/);
  db.close();
});

test('seed DEV é repetível, cria fornecedores/equipamentos e não inventa preços',()=>{
  const db=openDatabase(tempDir('catalog-seed'));
  assert.deepEqual(seedDevelopmentCatalog(db),{suppliersCreated:5,productsCreated:4,kitsCreated:2,kitItemsCreated:4,suppliersTotal:5,productsTotal:4,kitsTotal:2,pricesCreated:0});
  assert.deepEqual(seedDevelopmentCatalog(db),{suppliersCreated:0,productsCreated:0,kitsCreated:0,kitItemsCreated:0,suppliersTotal:5,productsTotal:4,kitsTotal:2,pricesCreated:0});
  assert.equal(db.prepare('SELECT count(*) AS n FROM suppliers').get().n,5);
  assert.equal(db.prepare('SELECT count(*) AS n FROM products').get().n,4);
  assert.equal(db.prepare('SELECT count(*) AS n FROM kits').get().n,2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM kit_items').get().n,4);
  assert.equal(db.prepare('SELECT count(*) AS n FROM price_history').get().n,0);
  db.close();
});
