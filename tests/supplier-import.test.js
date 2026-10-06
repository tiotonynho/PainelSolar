const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDatabase}=require('../db');
const {seedDevelopmentCatalog}=require('../catalog-seed');
const {createCatalogService}=require('../catalog-service');
const {createKitService}=require('../kit-service');
const {createSupplierImportService}=require('../supplier-import-service');
const ImportCore=require('../supplier-import-core');
const Procurement=require('../procurement-engine');
const {createServer}=require('../server');
const {ApiSupplierAdapter}=require('../api-supplier-adapter');

function tempDir(name){const dir=path.join(__dirname,'tmp',name+'-'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});return dir;}
function csv({sku='IMP-001',price='1000.00',captured='2026-10-06',productId='',stock='AVAILABLE',model='DEV Module 625W'}={}){return ['supplier_sku;product_id;manufacturer;model;category;power_wp;currency;price;stock_status;stock_quantity;lead_time_days;valid_until;captured_at',`${sku};${productId};DEV;${model};MODULE;625;BRL;${price};${stock};12;4;31/12/2027;${captured}`].join('\n');}

function setup(name){const db=openDatabase(tempDir(name));seedDevelopmentCatalog(db);const catalog=createCatalogService(db);const supplier=catalog.findSupplierBySlug('aldo-solar');const product=catalog.findProduct('MODULE','DEV','DEV Module 625W');return {db,catalog,supplier,product,service:createSupplierImportService(db)};}

test('CSV parser suporta separador, decimal brasileiro e rejeita ambiguidade',()=>{
  const parsed=ImportCore.parseCsv('sku;price;currency\nA;"1.234,56";BRL',{delimiter:';'});assert.equal(parsed.records[0].price,'1.234,56');
  assert.equal(ImportCore.parseDecimal('1.234,56',{field:'price'}),1234.56);assert.equal(ImportCore.parseDecimal('1234.56',{field:'price'}),1234.56);assert.throws(()=>ImportCore.parseDecimal('1.234',{field:'price'}),/ambiguo/);assert.throws(()=>ImportCore.parseCsv('a,a\n1,2'),/duplicados/);
});

test('API adapter usa credencial de ambiente, timeout e retry limitado',async()=>{
  const envName='PAINELSOLAR_TEST_SUPPLIER_TOKEN',previous=process.env[envName];process.env[envName]='test-only';let calls=0;
  try{
    let authorization='';const adapter=new ApiSupplierAdapter({baseUrl:'https://supplier.example',credentialEnv:envName,maxRetries:1,fetchImpl:async(_,init)=>{calls++;authorization=init.headers.Authorization;if(calls===1)return {status:503,ok:false};return {status:200,ok:true,json:async()=>({records:[]})};}});
    assert.deepEqual(await adapter.fetchOffers('/offers'),{records:[]});assert.equal(calls,2);assert.equal(authorization,'Bearer test-only');
  }finally{if(previous===undefined)delete process.env[envName];else process.env[envName]=previous;}
});

test('preview e staging nao escrevem ofertas comerciais',()=>{
  const {db,supplier,service}=setup('import-preview');try{
    const preview=service.previewCsv({supplierId:supplier.id,content:csv(),fileName:'dev.csv'});assert.equal(preview.dryRun,true);assert.equal(preview.report.valid,1);assert.equal(preview.report.matched,1);assert.equal(db.prepare('SELECT count(*) n FROM supplier_offers').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM supplier_kit_offers').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM price_history').get().n,0);
  }finally{db.close();}
});

test('upload cria batch validado, dry-run mostra diff e publish e explicito',()=>{
  const {db,supplier,product,service}=setup('import-publish');try{
    const batch=service.createCsvImport({supplierId:supplier.id,content:csv({productId:product.id}),fileName:'dev.csv',createdBy:'admin'});assert.equal(batch.status,'READY_TO_PUBLISH');assert.equal(batch.validRecords,1);assert.equal(batch.newRecords,1);
    const dry=service.dryRun(batch.id);assert.equal(dry.dryRun,true);assert.equal(dry.databaseWrites,0);assert.equal(dry.summary.new,1);assert.equal(db.prepare('SELECT count(*) n FROM supplier_offers').get().n,0);
    const published=service.publish(batch.id,{actorId:'admin'});assert.equal(published.status,'PUBLISHED');assert.equal(db.prepare('SELECT count(*) n FROM supplier_offers').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM price_history').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM supplier_import_items WHERE status=\'PUBLISHED\'').get().n,1);
    const same=service.createCsvImport({supplierId:supplier.id,content:csv({productId:product.id}),fileName:'renamed.csv',createdBy:'admin'});assert.equal(same.id,batch.id);assert.equal(same.idempotent,true);assert.equal(db.prepare('SELECT count(*) n FROM supplier_offers').get().n,1);
  }finally{db.close();}
});

test('alteracao de preco preserva PriceHistory e preco sem alteracao nao cria ruido',()=>{
  const {db,supplier,product,service}=setup('import-history');try{
    const first=service.createCsvImport({supplierId:supplier.id,content:csv({productId:product.id,price:'1000.00'}),createdBy:'admin'});service.publish(first.id,{actorId:'admin'});
    const second=service.createCsvImport({supplierId:supplier.id,content:csv({productId:product.id,price:'1200.00',captured:'2026-10-07'}),createdBy:'admin'});assert.equal(second.status,'REVIEW_REQUIRED');service.publish(second.id,{actorId:'admin',confirmReview:true});assert.equal(db.prepare('SELECT count(*) n FROM price_history').get().n,2);assert.equal(db.prepare('SELECT price FROM supplier_offers').get().price,1200);
    const third=service.createCsvImport({supplierId:supplier.id,content:csv({productId:product.id,price:'1200.00',captured:'2026-10-08'}),createdBy:'admin'});service.publish(third.id,{actorId:'admin'});assert.equal(db.prepare('SELECT count(*) n FROM price_history').get().n,2);
  }finally{db.close();}
});

test('preco com variacao acima do threshold exige review explicito',()=>{
  const {db,supplier,product,service}=setup('import-anomaly');try{
    const first=service.createCsvImport({supplierId:supplier.id,content:csv({productId:product.id,price:'1000.00'}),createdBy:'admin'});service.publish(first.id,{actorId:'admin'});
    const next=service.createCsvImport({supplierId:supplier.id,content:csv({productId:product.id,price:'1300.00',captured:'2026-10-09'}),createdBy:'admin'});assert.equal(next.status,'REVIEW_REQUIRED');assert.ok(next.warnings.some(item=>item.code==='PRICE_CHANGE_REVIEW_REQUIRED'));assert.throws(()=>service.publish(next.id,{actorId:'admin'}),/revisao/);const published=service.publish(next.id,{actorId:'admin',confirmReview:true});assert.equal(published.status,'PUBLISHED');
  }finally{db.close();}
});

test('SKU desconhecido fica UNMATCHED e nao chega ao ProcurementEngine',()=>{
  const {db,supplier,service}=setup('import-unmatched');try{
    const batch=service.createCsvImport({supplierId:supplier.id,content:csv({sku:'UNKNOWN-SKU',productId:'',price:'900.00',model:'Unknown Model'}),createdBy:'admin'});assert.equal(batch.status,'REVIEW_REQUIRED');assert.equal(batch.unmatchedRecords,1);assert.throws(()=>service.publish(batch.id,{actorId:'admin',confirmReview:true}),/invalidos|correspondencia/);assert.equal(db.prepare('SELECT count(*) n FROM supplier_offers').get().n,0);assert.equal(Procurement.procure({compatibleKits:[],kits:[],now:Date.now()}).evaluatedOffers,0);
  }finally{db.close();}
});

test('correspondencia assistida permite revisar item e publicar sem criar Product incerto',()=>{
  const {db,supplier,product,service}=setup('import-review');try{
    const batch=service.createCsvImport({supplierId:supplier.id,content:csv({sku:'REVIEW-SKU',productId:'',price:'950.00',model:'Review Model'}),createdBy:'admin'});const item=batch.items?.[0]||service.getBatch(batch.id).items[0];assert.equal(batch.unmatchedRecords,1);const reviewed=service.reviewItem(batch.id,item.id,{productId:product.id,actorId:'admin'});assert.equal(reviewed.status,'READY_TO_PUBLISH');const published=service.publish(batch.id,{actorId:'admin'});assert.equal(published.status,'PUBLISHED');assert.equal(db.prepare('SELECT count(*) n FROM products').get().n,4);
  }finally{db.close();}
});

test('falha durante publish faz rollback sem publicacao parcial',()=>{
  const {db,supplier,product,service}=setup('import-rollback');try{
    const batch=service.createCsvImport({supplierId:supplier.id,content:csv({sku:'ROLLBACK-SKU',productId:product.id}),createdBy:'admin'});db.prepare('UPDATE supplier_import_items SET normalized_data_json=? WHERE batch_id=?').run(JSON.stringify({...service.getBatch(batch.id).items[0].normalizedData,productId:'PRODUCT-NOT-FOUND'}),batch.id);
    assert.throws(()=>service.publish(batch.id,{actorId:'admin'}));assert.equal(db.prepare('SELECT count(*) n FROM supplier_offers').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM supplier_products').get().n,0);
  }finally{db.close();}
});

test('KIT_OFFER publicado fica disponível para o domínio de procurement',()=>{
  const {db,catalog,supplier,service}=setup('import-kit');try{
    const kits=createKitService(db).listKits();const kit=kits.find(item=>item.slug==='dev-kit-8-125-kwp');const content=['entity_type;supplier_sku;kit_id;kit_name;currency;price;stock_status;stock_quantity;lead_time_days;valid_until;captured_at',`KIT_OFFER;KIT-DEV-IMPORT;${kit.id};DEV Kit Import;BRL;15000;AVAILABLE;8;5;31/12/2027;2026-10-06`].join('\n');
    const batch=service.createCsvImport({supplierId:supplier.id,content,fileName:'kit.csv',createdBy:'admin'});assert.equal(batch.status,'READY_TO_PUBLISH');service.publish(batch.id,{actorId:'admin'});const row=db.prepare('SELECT price,stock_status FROM supplier_kit_offers').get();assert.equal(row.price,15000);assert.equal(row.stock_status,'AVAILABLE');const hydrated=createKitService(db).getKit(kit.id);assert.equal(hydrated.supplierKits[0].offers[0].price,15000);assert.equal(catalog.findSupplierBySlug('aldo-solar').id,supplier.id);
  }finally{db.close();}
});
test('API de importacao exige admin e separa upload de publish',async t=>{
  const dir=tempDir('import-api'),seedDb=openDatabase(dir);seedDevelopmentCatalog(seedDb);const supplier=createCatalogService(seedDb).findSupplierBySlug('aldo-solar');const product=createCatalogService(seedDb).findProduct('MODULE','DEV','DEV Module 625W');seedDb.close();
  const server=createServer({dataDir:dir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  async function request(route,method='GET',data,cookie=''){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  assert.equal((await request('/api/admin/supplier-imports')).status,401);
  const setup=await request('/api/auth/setup','POST',{name:'Import Admin',email:'import-admin@example.com',password:'import-admin-password'});assert.equal(setup.status,201);const cookie=setup.cookie;
  assert.equal((await request('/api/admin/suppliers','GET',undefined,cookie)).data.length,5);
  const content=['supplier_sku;product_id;manufacturer;model;category;power_wp;currency;price;stock_status;stock_quantity;lead_time_days;valid_until;captured_at',`API-DEV;${product.id};DEV;DEV Module 625W;MODULE;625;BRL;1000;AVAILABLE;3;4;31/12/2027;2026-10-06`].join('\n');
  const batch=await request('/api/admin/supplier-imports','POST',{supplierId:supplier.id,sourceType:'CSV',fileName:'api-dev.csv',content,createdBy:'ignored'},cookie);assert.equal(batch.status,201);assert.equal(batch.data.status,'READY_TO_PUBLISH');
  const before=openDatabase(dir);assert.equal(before.prepare('SELECT count(*) n FROM supplier_offers').get().n,0);before.close();
  assert.equal((await request('/api/admin/supplier-imports/'+batch.data.id+'/dry-run','POST',{},cookie)).data.databaseWrites,0);
  const published=await request('/api/admin/supplier-imports/'+batch.data.id+'/publish','POST',{},cookie);assert.equal(published.status,200);assert.equal(published.data.status,'PUBLISHED');
  const after=openDatabase(dir);assert.equal(after.prepare('SELECT count(*) n FROM supplier_offers').get().n,1);assert.equal(after.prepare('SELECT count(*) n FROM price_history').get().n,1);after.close();
  assert.equal((await request('/api/admin/supplier-imports','GET')).status,401);
});
