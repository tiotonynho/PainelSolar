const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {openDatabase}=require('../db');
const {createCommercialConfigService}=require('../commercial-config-service');
const {priceProposal,recalculateProposalPricing}=require('../proposal-pricing-service');
const {createServer}=require('../server');
const Core=require('../contract-core');

function tempDir(name){const dir=path.join(__dirname,'tmp',name+'-'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});return dir;}
function config(overrides={}){return {name:'DEV Commercial v1',pricingMode:'STANDARD',defaultInstallationCost:100,defaultEngineeringCost:50,defaultMarkupRate:.2,defaultTargetMarginRate:null,defaultCommissionRate:0,defaultTaxRate:0,defaultFreightRequired:false,...overrides};}
function standardProposal(overrides={}){return {clientName:'Cliente Standard',document:'12345678901',address:'Rua Solar, 10',city:'Alfenas',state:'MG',moduleBrand:'DEV',moduleModel:'Module625',modulePower:625,modules:13,inverterBrand:'DEV',inverterModel:'Inverter8kW',inverterPower:8,inverterQuantity:1,installedKwp:8.125,annualGeneration:12000,annualSavings:9000,pricingMode:'STANDARD',equipmentCost:1000,...overrides};}

test('CommercialConfig cria versões, ativa sem sobrescrever e audita alterações',()=>{
  const dir=tempDir('commercial-config');const db=openDatabase(dir);const service=createCommercialConfigService(db);
  try{
    const first=service.create(config(),'admin-1');
    assert.equal(first.version,1);assert.equal(first.active,false);assert.equal(first.defaultInstallationCostCents,10000);
    assert.equal(service.getActive(),null);
    service.activate(first.id,'admin-1');assert.equal(service.getActive().version,1);
    const second=service.create(config({name:'DEV Commercial v2',defaultMarkupRate:.25}),'admin-1');
    service.activate(second.id,'admin-1');
    assert.equal(service.get(first.id).active,false);assert.equal(service.get(second.id).active,true);
    assert.deepEqual(service.list().map(item=>item.version),[2,1]);
    assert.equal(service.audit().length,4);
    assert.throws(()=>service.create(config({defaultMarkupRate:.2,defaultTargetMarginRate:.2}),'admin-1'),/não ambos/);
    assert.throws(()=>service.create(config({defaultTaxRate:1.1}),'admin-1'),/entre/);
    assert.throws(()=>service.create(config({defaultCommissionRate:.1,defaultCommissionBase:null}),'admin-1'),/defaultCommissionBase/);
  }finally{db.close();}
});

test('ProposalPricingService aplica precedência override → config → legado e cria snapshot',()=>{
  const commercialConfig={version:7,pricingMode:'STANDARD',defaultInstallationCostCents:10000,defaultEngineeringCostCents:5000,defaultMarkupRate:.2,defaultTargetMarginRate:null,defaultCommissionRate:0,defaultCommissionBase:null,defaultTaxRate:0,defaultTaxBase:null,defaultFreightRequired:false};
  const priced=priceProposal(standardProposal(),{config:commercialConfig,now:Date.UTC(2026,0,1)});
  assert.equal(priced.proposal.customerPrice,1380);
  assert.equal(priced.proposal.investment,1380);
  assert.equal(priced.proposal.pricingSnapshot.customerPriceCents,138000);
  assert.equal(priced.proposal.pricingSnapshot.commercialConfigVersion,7);
  const override=priceProposal(standardProposal({markupRate:.3}),{config:commercialConfig});
  assert.equal(override.proposal.customerPrice,1495);
  const legacy=priceProposal({kitCost:5200,margin:49,installationRate:23.08,engineeringRate:12,taxRate:0,investment:9572.16},{now:Date.now()});
  assert.equal(legacy.proposal.customerPrice,9572.16);
  assert.equal(legacy.proposal.pricingMode,'LEGACY');
});

test('STANDARD com frete desconhecido exige revisão e não vira zero',()=>{
  const result=priceProposal(standardProposal(),{config:config({defaultFreightRequired:true})});
  assert.equal(result.result.pricingComplete,false);
  assert.equal(result.result.requiresReview,true);
  assert.ok(result.result.warnings.includes('FREIGHT_UNKNOWN'));
  assert.equal(result.proposal.customerPrice,null);
});

test('alterar configuração não muda snapshot existente; repricing explícito muda',()=>{
  const first={version:1,pricingMode:'STANDARD',defaultInstallationCostCents:0,defaultEngineeringCostCents:0,defaultMarkupRate:.2,defaultTargetMarginRate:null,defaultCommissionRate:0,defaultCommissionBase:null,defaultTaxRate:0,defaultTaxBase:null,defaultFreightRequired:false};
  const second={...first,version:2,defaultMarkupRate:.3};
  const original=priceProposal(standardProposal({equipmentCost:1000}),{config:first});
  const historical=JSON.parse(JSON.stringify(original.proposal));
  const repriced=recalculateProposalPricing(original.proposal,{config:second,pricingMode:'STANDARD'});
  assert.equal(historical.customerPrice,1200);assert.equal(original.proposal.customerPrice,1200);
  assert.equal(repriced.proposal.customerPrice,1300);assert.equal(repriced.proposal.commercialConfigVersion,2);
});

test('fluxo API STANDARD → snapshot → público → aceite → contrato preserva customerPrice',async t=>{
  const server=createServer({dataDir:tempDir('commercial-api')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  async function request(route,method='GET',data,cookie=''){
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  assert.equal((await request('/api/admin/commercial-config')).status,401);
  let cookie=(await request('/api/auth/setup','POST',{name:'Admin Stage7',email:'stage7@example.com',password:'test-only-password'})).cookie;
  const createdConfig=await request('/api/admin/commercial-config','POST',config(),cookie);assert.equal(createdConfig.status,201);
  const activated=await request('/api/admin/commercial-config/'+createdConfig.data.id+'/activate','PATCH',undefined,cookie);assert.equal(activated.status,200);
  const created=await request('/api/records','POST',{proposal:standardProposal(),isTest:true},cookie);assert.equal(created.status,201);
  const recordId=created.data.id,publicUrl=created.data.publicPath;
  assert.equal(created.data.proposal.customerPrice,1380);assert.equal(created.data.proposal.investment,1380);assert.equal(created.data.proposal.pricingSnapshot.commercialConfigVersion,1);
  const publicRecord=await request('/api/public/'+publicUrl.split('#')[1]);assert.equal(publicRecord.status,200);assert.equal(publicRecord.data.proposal.customerPrice,1380);
  for(const internal of ['equipmentCost','freightCost','landedCost','grossProfit','internalMargin','commission','supplierScore','procurementScore','commercialConfig','pricingSnapshot'])assert.equal(internal in publicRecord.data.proposal,false,`campo interno exposto: ${internal}`);
  const secondConfig=await request('/api/admin/commercial-config','POST',config({name:'DEV Commercial v2',defaultMarkupRate:.3}),cookie);assert.equal(secondConfig.status,201);
  await request('/api/admin/commercial-config/'+secondConfig.data.id+'/activate','PATCH',undefined,cookie);
  const unchanged=await request('/api/records/'+recordId,'GET',undefined,cookie);assert.equal(unchanged.status,200);assert.equal(unchanged.data.proposal.customerPrice,1380);assert.equal(unchanged.data.proposal.commercialConfigVersion,1);
  const repriced=await request('/api/records/'+recordId+'/pricing','POST',{commercialConfigVersion:2,reason:'Teste explícito'},cookie);assert.equal(repriced.status,200);assert.equal(repriced.data.proposal.customerPrice,1495);assert.equal(repriced.data.pricingHistory.length,1);
  const accepted=await request('/api/public/'+publicUrl.split('#')[1]+'/accept','POST',{name:'Cliente Standard',document:'12345678901',email:'cliente@example.com',confirmed:true});assert.equal(accepted.status,200);
  const blocked=await request('/api/records/'+recordId+'/pricing','POST',{commercialConfigVersion:1},cookie);assert.equal(blocked.status,409);
  const internal=await request('/api/records/'+recordId,'GET',undefined,cookie);assert.equal(internal.data.acceptance.customerPrice,1495);assert.equal(internal.data.acceptance.pricingMode,'STANDARD');
  const templateContext={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../contract-template.js'),'utf8'),templateContext);
  const contract=Core.generate(internal.data,{company:'Empresa',companyDocument:'00',companyAddress:'Rua',representative:'Resp',engineer:'Eng',utility:'Distribuidora',structure:'Telhado',payment:'80% + 20%',additional:'',deadline:'60',meter:'Conforme',jurisdiction:'Alfenas',date:'2026-09-27',backup:''},templateContext.window.CONTRACT_TEMPLATE);
  assert.ok(contract.includes('R$ 1.495,00')||contract.includes('R$ 1.495,00'));
});
