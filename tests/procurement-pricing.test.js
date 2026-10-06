const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Bridge=require('../procurement-pricing-bridge');
const Pricing=require('../proposal-pricing-service');
const Sizing=require('../solar-sizing-engine');
const Matching=require('../kit-matching-engine');
const {createServer}=require('../server');

const NOW=1_700_000_000_000;
const config={version:1,pricingMode:'STANDARD',defaultInstallationCostCents:10000,defaultEngineeringCostCents:5000,defaultMarkupRate:.2,defaultTargetMarginRate:null,defaultCommissionRate:0,defaultCommissionBase:null,defaultTaxRate:0,defaultTaxBase:null,defaultFreightRequired:false};
const option=(overrides={})=>({kitId:'KIT-1',kitName:'DEV Kit',supplierId:'SUP-1',supplierName:'DEV Supplier',supplierKitId:'SK-1',supplierKitOfferId:'O-1',equipmentPrice:1000,freightCost:100,freightStatus:'KNOWN',stockStatus:'AVAILABLE',leadTimeDays:4,technicalScore:96,procurementScore:90,supplierScore:90,supplierActive:true,kitActive:true,offerValid:true,offerValidUntil:NOW+86400000,technicalMatchValid:true,reasons:['TECHNICAL_MATCH'],warnings:[],requiresReview:false,...overrides});
const result=(best=option(),overrides={})=>({bestOption:best,alternatives:[],rejected:[],requiresReview:false,warnings:[],...overrides});
const proposal=(overrides={})=>({clientName:'Cliente Procurement',document:'12345678901',address:'Rua Solar, 10',city:'Alfenas',state:'MG',moduleBrand:'DEV',moduleModel:'Module625',modulePower:625,modules:11,inverterBrand:'DEV',inverterModel:'Inverter5kW',inverterPower:5,inverterQuantity:1,installedKwp:6.875,annualGeneration:9600,annualSavings:7000,pricingMode:'STANDARD',pricingSource:'PROCUREMENT',...overrides});
function tempDir(name){const dir=path.join(__dirname,'tmp',name+'-'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});return dir;}

test('canAutoPriceFromProcurement aceita oferta completa e rejeita dados críticos desconhecidos',()=>{
  assert.equal(Bridge.canAutoPriceFromProcurement(result(),{now:NOW}).canAutoPrice,true);
  assert.ok(Bridge.canAutoPriceFromProcurement(result(option({freightCost:null,freightStatus:'UNKNOWN'}))).blockingReasons.includes('FREIGHT_UNKNOWN'));
  assert.ok(Bridge.canAutoPriceFromProcurement(result(option({stockStatus:'UNKNOWN'}))).blockingReasons.includes('STOCK_UNKNOWN'));
  assert.ok(Bridge.canAutoPriceFromProcurement(result(option({stockStatus:'LOW_STOCK'}))).blockingReasons.includes('LOW_STOCK'));
  assert.ok(Bridge.canAutoPriceFromProcurement(result(option({stockStatus:'OUT_OF_STOCK'}))).blockingReasons.includes('OUT_OF_STOCK'));
  assert.ok(Bridge.canAutoPriceFromProcurement(result(option({offerValidUntil:NOW}))).blockingReasons.includes('OFFER_EXPIRED'));
  assert.ok(Bridge.canAutoPriceFromProcurement(result(option({supplierActive:false}))).blockingReasons.includes('SUPPLIER_INACTIVE'));
  assert.ok(Bridge.canAutoPriceFromProcurement(result(option({kitActive:false}))).blockingReasons.includes('KIT_INACTIVE'));
  assert.ok(Bridge.canAutoPriceFromProcurement({bestOption:null}).blockingReasons.includes('NO_BEST_OPTION'));
});

test('mapping Procurement → Pricing preserva equipamento e frete',()=>{
  const mapped=Bridge.mapProcurementToPricingInput(option({equipmentPrice:1234.56,freightCost:78.9}));
  assert.equal(mapped.equipmentCost,1234.56);assert.equal(mapped.freightCost,78.9);assert.equal(mapped.pricingSource,'PROCUREMENT');
  const priced=Pricing.priceProposal(proposal(),{config,procurementResult:result(option({equipmentPrice:1234.56,freightCost:78.9})),now:NOW});
  assert.equal(priced.proposal.pricingSource,'PROCUREMENT');assert.equal(priced.proposal.pricingSnapshot.equipmentCostCents,123456);assert.equal(priced.proposal.pricingSnapshot.freightCostCents,7890);assert.equal(priced.proposal.customerPrice,1756.15);
});

test('procurement automatico bloqueia proposta quando frete ou estoque exigem revisão',()=>{
  const freight=Pricing.priceProposal(proposal(),{config,procurementResult:result(option({freightCost:null,freightStatus:'UNKNOWN'})),now:NOW});
  assert.equal(freight.result.pricingComplete,false);assert.equal(freight.proposal.customerPrice,null);assert.ok(freight.proposal.pricingSnapshot.procurementDecision.blockingReasons.includes('FREIGHT_UNKNOWN'));
  const stock=Pricing.priceProposal(proposal(),{config,procurementResult:result(option({stockStatus:'UNKNOWN'})),now:NOW});
  assert.equal(stock.result.pricingComplete,false);assert.ok(stock.proposal.pricingSnapshot.procurementDecision.blockingReasons.includes('STOCK_UNKNOWN'));
});

test('override manual seleciona alternativa, exige motivo e deixa auditoria no snapshot',()=>{
  const alternative=option({supplierId:'SUP-2',supplierKitId:'SK-2',supplierKitOfferId:'O-2',equipmentPrice:1100,procurementScore:80});
  const priced=Pricing.priceProposal(proposal({selectionMode:'MANUAL',selectedOfferId:'O-2',overrideReason:'Fornecedor preferencial para este projeto'}),{config,procurementResult:result(option(),{alternatives:[alternative]}),now:NOW});
  assert.equal(priced.proposal.customerPrice,1620);assert.equal(priced.proposal.selectionMode,'MANUAL');assert.equal(priced.proposal.pricingSnapshot.procurementSnapshot.supplierKitOfferId,'O-2');assert.equal(priced.proposal.pricingSnapshot.procurementSnapshot.override,true);assert.ok(priced.result.warnings.includes('PROCUREMENT_MANUAL_OVERRIDE'));
  assert.throws(()=>Pricing.priceProposal(proposal({selectionMode:'MANUAL',selectedOfferId:'O-2'}),{config,procurementResult:result(option(),{alternatives:[alternative]}),now:NOW}),/overrideReason/);
});

test('snapshot de procurement nao muda quando a oferta original e alterada',()=>{
  const selected=option();const priced=Pricing.priceProposal(proposal(),{config,procurementResult:result(selected),now:NOW});
  const snapshot=JSON.parse(JSON.stringify(priced.proposal.pricingSnapshot));selected.equipmentPrice=99999;selected.supplierId='CHANGED';
  assert.deepEqual(priced.proposal.pricingSnapshot,snapshot);assert.equal(priced.proposal.pricingSnapshot.procurementSnapshot.equipmentPrice,1000);
});

test('fluxo sizing → matching → procurement result → pricing usa somente fixture DEV',()=>{
  const sizing=Sizing.calculateSizing({monthlyConsumptionKwh:850,hsp:4.8,performanceRatio:.8,connectionType:'BIPHASIC',modulePowerWp:625});
  const module={id:'DEV-MODULE',category:'MODULE',manufacturer:'DEV',model:'Module625',specifications:{powerWp:625}};
  const kit={id:'KIT-DEV-E2E',name:'DEV Kit 6.875 kWp',nominalPowerWp:6875,phaseType:'BIPHASIC',voltage:'220 V',active:true,items:[{id:'KIT-DEV-ITEM',kitId:'KIT-DEV-E2E',productId:module.id,quantity:sizing.moduleCount,role:'MODULE',product:module}]};
  const matching=Matching.matchKits({requiredDcPowerWp:sizing.requiredDcPowerWp,installedDcPowerWp:sizing.installedDcPowerWp,modulePowerWp:sizing.modulePowerWp,moduleCount:sizing.moduleCount,connectionType:sizing.connectionType,voltage:220},[kit]);
  assert.equal(matching.matches.length,1);
  const procurement=result(option({kitId:kit.id,equipmentPrice:12000,freightCost:500,technicalScore:matching.matches[0].technicalScore}),{evaluatedTechnicalKits:1,evaluatedOffers:1});
  const priced=Pricing.priceProposal(proposal({installedKwp:sizing.installedDcPowerWp/1000}),{config,procurementResult:procurement,now:NOW});
  assert.equal(priced.result.pricingComplete,true);assert.equal(priced.proposal.pricingSnapshot.procurementSnapshot.kitId,kit.id);assert.equal(priced.proposal.pricingSnapshot.equipmentCostCents,1200000);
});

test('API integra procurement, preserva snapshot interno e nao o expoe publicamente',async t=>{
  const server=createServer({dataDir:tempDir('procurement-api')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  async function request(route,method='GET',data,cookie=''){
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const cookie=(await request('/api/auth/setup','POST',{name:'Admin Procurement',email:'procurement@example.com',password:'test-only-password'})).cookie;
  const configResponse=await request('/api/admin/commercial-config','POST',{name:'DEV Procurement Config',pricingMode:'STANDARD',defaultInstallationCost:0,defaultEngineeringCost:0,defaultMarkupRate:.2,defaultTargetMarginRate:null,defaultCommissionRate:0,defaultTaxRate:0,defaultFreightRequired:false},cookie);
  await request('/api/admin/commercial-config/'+configResponse.data.id+'/activate','PATCH',undefined,cookie);
  const procurementResult=result(option({equipmentPrice:1000,freightCost:100,offerValidUntil:Date.now()+86400000}));
  const created=await request('/api/records','POST',{proposal:proposal(),pricingSource:'PROCUREMENT',procurementResult,isTest:true},cookie);
  assert.equal(created.status,201);assert.equal(created.data.proposal.pricingSource,'PROCUREMENT');assert.equal(created.data.proposal.pricingSnapshot.procurementSnapshot.supplierKitOfferId,'O-1');
  const publicRecord=await request('/api/public/'+created.data.publicPath.split('#')[1]);assert.equal(publicRecord.status,200);
  for(const key of ['supplierId','supplierKitOfferId','equipmentCost','freightCost','landedCost','supplierScore','procurementScore','procurementSnapshot'])assert.equal(key in publicRecord.data.proposal,false,key+' nao deveria ser publico');
  const refreshedResult=result(option({equipmentPrice:1400,offerValidUntil:Date.now()+86400000}));
  const refreshed=await request('/api/records/'+created.data.id+'/procurement','POST',{procurementResult:refreshedResult},cookie);assert.equal(refreshed.status,200);assert.equal(refreshed.data.proposal.customerPrice,1320);
  const repriced=await request('/api/records/'+created.data.id+'/pricing','POST',{pricingSource:'PROCUREMENT',procurementResult:refreshedResult,reason:'Refresh explicito'},cookie);assert.equal(repriced.status,200);assert.equal(repriced.data.proposal.customerPrice,1800);assert.equal(repriced.data.pricingHistory.length,1);
  const accepted=await request('/api/public/'+repriced.data.publicPath.split('#')[1]+'/accept','POST',{name:'Cliente Procurement',document:'12345678901',email:'cliente@example.com',confirmed:true});assert.equal(accepted.status,200);
  assert.equal((await request('/api/records/'+created.data.id+'/procurement','POST',{procurementResult:refreshedResult},cookie)).status,409);
  assert.equal((await request('/api/records/'+created.data.id+'/pricing','POST',{pricingSource:'PROCUREMENT',procurementResult:refreshedResult},cookie)).status,409);
});
