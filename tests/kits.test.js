const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDatabase}=require('../db');
const {createCatalogService}=require('../catalog-service');
const {createKitService}=require('../kit-service');
const {seedDevelopmentCatalog}=require('../catalog-seed');
const {createServer}=require('../server');

function tempDir(prefix){
  const dir=path.join(__dirname,'../tmp',prefix+'-'+crypto.randomUUID());
  fs.mkdirSync(dir,{recursive:true});
  return dir;
}

function baseCatalog(db){
  const catalog=createCatalogService(db);
  const moduleProduct=catalog.createProduct({id:'PROD-MODULE',category:'MODULE',manufacturer:'DEV',model:'Module625',specifications:{powerWp:625}});
  const inverterProduct=catalog.createProduct({id:'PROD-INVERTER',category:'INVERTER',manufacturer:'DEV',model:'Inverter8kW',specifications:{nominalPowerW:8000}});
  return {catalog,moduleProduct,inverterProduct};
}

test('kit calcula potência DC dos módulos e sinaliza divergência nominal',()=>{
  const db=openDatabase(tempDir('kit-power'));
  const {catalog,moduleProduct,inverterProduct}=baseCatalog(db);
  const kitService=createKitService(db);
  const kit=kitService.createKit({id:'KIT-8125',name:'Kit 8.125 kWp',slug:'kit-8125',nominalPowerWp:8125,phaseType:'BIPHASIC',voltage:'127/220 V'});
  kitService.addKitItem(kit.id,{productId:moduleProduct.id,quantity:13,role:'MODULE'});
  kitService.addKitItem(kit.id,{productId:inverterProduct.id,quantity:1,role:'INVERTER'});
  const active=kitService.updateKit(kit.id,{active:true});
  assert.equal(kitService.calculateDcPower(kit.id),8125);
  assert.equal(active.calculatedModulePowerWp,8125);
  assert.equal(active.validation.valid,true);
  const divergent=kitService.updateKit(kit.id,{nominalPowerWp:8000});
  assert.equal(divergent.validation.valid,true);
  assert.equal(divergent.validation.powerDiverges,true);
  assert.ok(divergent.validation.warnings.some(message=>message.includes('diverge')));
  db.close();
});

test('kit ativo exige composição, permite desativação e preserva a composição',()=>{
  const db=openDatabase(tempDir('kit-lifecycle'));
  const {moduleProduct}=baseCatalog(db);
  const kitService=createKitService(db);
  assert.throws(()=>kitService.createKit({id:'KIT-EMPTY',name:'Kit vazio',slug:'kit-vazio',nominalPowerWp:625,phaseType:'FLEXIBLE',voltage:'220 V',active:true}),/pelo menos um componente/);
  const kit=kitService.createKit({id:'KIT-DRAFT',name:'Kit rascunho',slug:'kit-rascunho',nominalPowerWp:625,phaseType:'FLEXIBLE',voltage:'220 V'});
  const item=kitService.addKitItem(kit.id,{productId:moduleProduct.id,quantity:1,role:'MODULE'});
  kitService.updateKit(kit.id,{active:true});
  assert.throws(()=>kitService.removeKitItem(kit.id,item.id),/pelo menos um componente/);
  const inactive=kitService.updateKit(kit.id,{active:false});
  assert.equal(inactive.active,false);
  assert.equal(inactive.items.length,1);
  assert.equal(kitService.removeKitItem(kit.id,item.id).items.length,0);
  db.close();
});

test('KitItem valida produto, quantidade e duplicidade',()=>{
  const db=openDatabase(tempDir('kit-items'));
  const {moduleProduct}=baseCatalog(db);
  const kitService=createKitService(db);
  const kit=kitService.createKit({id:'KIT-ITEMS',name:'Kit itens',slug:'kit-itens',nominalPowerWp:625,phaseType:'MONOPHASIC',voltage:'220 V'});
  assert.throws(()=>kitService.addKitItem(kit.id,{productId:moduleProduct.id,quantity:0,role:'MODULE'}),/maior que zero/);
  assert.throws(()=>kitService.addKitItem(kit.id,{productId:'MISSING',quantity:1,role:'MODULE'}),/Produto não encontrado/);
  kitService.addKitItem(kit.id,{productId:moduleProduct.id,quantity:1,role:'MODULE'});
  assert.throws(()=>kitService.addKitItem(kit.id,{productId:moduleProduct.id,quantity:2,role:'MODULE'}),/já existem/);
  db.close();
});

test('SupplierKit e SupplierKitOffer reutilizam kit e fornecedor e preservam histórico',()=>{
  const db=openDatabase(tempDir('supplier-kit'));
  const {catalog,moduleProduct}=baseCatalog(db);
  const kitService=createKitService(db);
  const supplier=catalog.createSupplier({id:'SUP-ALDO',name:'Aldo Solar',slug:'aldo-solar'});
  const kit=kitService.createKit({id:'KIT-SUP',name:'Kit fornecedor',slug:'kit-fornecedor',nominalPowerWp:625,phaseType:'BIPHASIC',voltage:'127/220 V'});
  kitService.addKitItem(kit.id,{productId:moduleProduct.id,quantity:1,role:'MODULE'});
  const supplierKit=kitService.createSupplierKit({id:'SK-ALDO',supplierId:supplier.id,kitId:kit.id,supplierSku:'ALDO-001',supplierName:'Kit DEV'});
  const offer=kitService.createSupplierKitOffer({id:'SKO-001',supplierKitId:supplierKit.id,price:10000,stockStatus:'AVAILABLE',stockQuantity:3,leadTimeDays:7,capturedAt:1000});
  kitService.updateSupplierKitOffer(offer.id,{price:9500,capturedAt:2000,stockStatus:'LOW_STOCK'});
  const complete=kitService.getKit(kit.id);
  assert.equal(complete.supplierKits[0].supplier.id,supplier.id);
  assert.equal(complete.supplierKits[0].offers[0].stockStatus,'LOW_STOCK');
  assert.deepEqual(db.prepare('SELECT price,supplier_kit_id,captured_at FROM price_history WHERE supplier_kit_id=? ORDER BY captured_at').all(supplierKit.id).map(row=>({price:Number(row.price),supplier_kit_id:row.supplier_kit_id,captured_at:Number(row.captured_at)})),[
    {price:10000,supplier_kit_id:supplierKit.id,captured_at:1000},
    {price:9500,supplier_kit_id:supplierKit.id,captured_at:2000}
  ]);
  assert.throws(()=>kitService.createSupplierKit({id:'SK-BAD',supplierId:'MISSING',kitId:kit.id,supplierSku:'BAD'}),/Fornecedor não encontrado/);
  db.close();
});

test('rotas de kits exigem administrador e retornam composição completa',async t=>{
  const dataDir=tempDir('kit-api');
  let db=openDatabase(dataDir);seedDevelopmentCatalog(db);
  const catalog=createCatalogService(db);
  const moduleProduct=catalog.findProduct('MODULE','DEV','DEV Module 625W');
  const supplier=catalog.findSupplierBySlug('aldo-solar');
  db.close();
  let server=createServer({dataDir});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  let base='http://127.0.0.1:'+server.address().port;
  async function request(route,method='GET',data,cookie=''){
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  assert.equal((await request('/api/admin/kits')).status,401);
  const setup=await request('/api/auth/setup','POST',{name:'Admin',email:'admin@example.com',password:'admin-password-123'});
  const admin=setup.cookie;
  const draft=await request('/api/admin/kits','POST',{name:'API Kit',slug:'api-kit',nominalPowerWp:8125,phaseType:'BIPHASIC',voltage:'127/220 V',active:false},admin);
  assert.equal(draft.status,201);
  assert.equal((await request('/api/admin/kits/'+draft.data.id+'/items','POST',{productId:moduleProduct.id,quantity:13,role:'MODULE'},admin)).status,201);
  assert.equal((await request('/api/admin/kits/'+draft.data.id,'PUT',{active:true},admin)).status,200);
  const supplierKit=await request('/api/admin/kits/'+draft.data.id+'/supplier-kits','POST',{supplierId:supplier.id,supplierSku:'API-001',supplierName:'Kit API'},admin);
  assert.equal(supplierKit.status,201);
  assert.equal((await request('/api/admin/supplier-kits/'+supplierKit.data.id+'/offers','POST',{price:9000,stockStatus:'AVAILABLE',stockQuantity:2,leadTimeDays:5,capturedAt:3000},admin)).status,201);
  const complete=await request('/api/admin/kits/'+draft.data.id, 'GET',undefined,admin);
  assert.equal(complete.status,200);
  assert.equal(complete.data.items[0].product.model,'DEV Module 625W');
  assert.equal(complete.data.calculatedModulePowerWp,8125);
  assert.equal(complete.data.supplierKits[0].offers.length,1);
  const seller=await request('/api/users','POST',{name:'Seller',email:'seller@example.com',password:'seller-password-123',role:'seller'},admin);
  assert.equal(seller.status,201);
  const sellerLogin=await request('/api/login','POST',{email:'seller@example.com',password:'seller-password-123'});
  assert.equal((await request('/api/admin/kits','GET',undefined,sellerLogin.cookie)).status,403);
});
