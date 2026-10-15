const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createServer}=require('../server');

function solarFetch(url){
  const value=String(url);
  if(value.includes('geocoding-api.open-meteo.com/'))return Promise.resolve({ok:true,json:async()=>({results:[{name:'Alfenas',country_code:'BR',admin1:'Minas Gerais',latitude:-21.43,longitude:-45.95}]})});
  if(value.includes('power.larc.nasa.gov/'))return Promise.resolve({ok:true,json:async()=>({properties:{parameter:{ALLSKY_SFC_SW_DWN:{JAN:4.8,FEB:4.8,MAR:4.8,APR:4.8,MAY:4.8,JUN:4.8,JUL:4.8,AUG:4.8,SEP:4.8,OCT:4.8,NOV:4.8,DEC:4.8,ANN:4.8}}},parameters:{ALLSKY_SFC_SW_DWN:{units:'kWh/m²/dia'}},header:{range:'fixture'}})});
  throw new Error('unexpected URL '+value);
}

test('diagnóstico público persiste, valida anexos, exige autenticação e converte sem duplicar',async t=>{
  const dataDir=path.join(__dirname,'tmp','diagnostics-'+crypto.randomUUID());fs.mkdirSync(dataDir,{recursive:true});
  const server=createServer({dataDir,fetchImpl:solarFetch});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(route,method='GET',data,cookie=''){
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const landing=await fetch(base+'/portico/diagnostico');assert.equal(landing.status,200);assert.match(await landing.text(),/Descubra quanto você pode economizar/);
  const publicConfig=await request('/api/public/diagnostics/config');assert.equal(publicConfig.status,200);assert.equal(publicConfig.data.financing.active,false);assert.equal(publicConfig.data.financing.text,'Consulte opções de financiamento para o seu projeto.');
  const input={submissionKey:'diagnostic-test-001',name:'Cliente Teste',whatsapp:'35999998888',city:'Alfenas',state:'MG',profile:'RESIDENTIAL',averageConsumptionKwh:850,averageBillAmount:620,propertyStatus:'OWNED',email:'cliente@example.com',connectionType:'BIPHASIC',roofType:'TILE',shade:'NONE',consumptionIncrease:'NOT_SURE',financingInterest:'YES',privacyAccepted:true,marketingOptIn:false,source:'portico-diagnostico',utm:{campaign:'teste'}};
  const created=await request('/api/public/diagnostics','POST',input);assert.equal(created.status,201);assert.match(created.data.protocol,/^PS-\d{4}-[A-F0-9]+$/);assert.equal(created.data.status,'RECEIVED');
  const duplicate=await request('/api/public/diagnostics','POST',input);assert.equal(duplicate.status,200);assert.equal(duplicate.data.protocol,created.data.protocol);assert.equal(duplicate.data.duplicate,true);
  const incomplete=await request('/api/public/diagnostics','POST',{...input,submissionKey:'diagnostic-pending-01',averageConsumptionKwh:undefined,averageBillAmount:400,connectionType:'NOT_SURE',roofType:'NOT_SURE'});assert.equal(incomplete.status,201);
  const invalid=await request('/api/public/diagnostics','POST',{...input,submissionKey:'diagnostic-invalid-01',averageConsumptionKwh:null,averageBillAmount:null});assert.equal(invalid.status,400);
  const badFile=await request('/api/public/diagnostics','POST',{...input,submissionKey:'diagnostic-file-01',attachment:{filename:'fatura.pdf',contentType:'application/pdf',data:'data:application/pdf;base64,SGVsbG8='}});assert.equal(badFile.status,400);
  assert.equal((await request('/api/admin/diagnostics')).status,401);
  const setup=await request('/api/auth/setup','POST',{name:'Admin Diagnóstico',email:'admin-diagnostic@example.com',password:'test-only-password'});assert.equal(setup.status,201);const admin=setup.cookie;
  const list=await request('/api/admin/diagnostics','GET',undefined,admin);assert.equal(list.status,200);assert.equal(list.data.total,2);const diagnosticId=list.data.items.find(item=>item.protocol===created.data.protocol).id;const incompleteRow=list.data.items.find(item=>item.protocol===incomplete.data.protocol);
  const partial=await request('/api/admin/diagnostics/'+incompleteRow.id+'/study','POST',{},admin);assert.equal(partial.status,200);assert.equal(partial.data.status,'DATA_PENDING');assert.ok(partial.data.pending.length>0);
  const detail=await request('/api/admin/diagnostics/'+diagnosticId,'GET',undefined,admin);assert.equal(detail.status,200);assert.equal(detail.data.originalData.averageConsumptionKwh,850);assert.equal(detail.data.attachments.length,0);
  const study=await request('/api/admin/diagnostics/'+diagnosticId+'/study','POST',{corrections:{tariffPerKwh:1.1,hsp:4.8,voltage:'220 V'}},admin);assert.equal(study.status,200);assert.equal(study.data.study.engine,'SolarSizingEngine');assert.ok(study.data.study.sizing.annualGenerationKwh>0);assert.ok(study.data.study.financial.annualSavings.value>0);
  const corrected=await request('/api/admin/diagnostics/'+diagnosticId,'GET',undefined,admin);assert.equal(corrected.data.originalData.tariffPerKwh,null);assert.equal(corrected.data.correctedData.tariffPerKwh,1.1);
  const proposal={clientName:'Cliente Teste',address:'A confirmar',city:'Alfenas',state:'MG',moduleBrand:'Marca confirmada',moduleModel:'Modulo 625',modulePower:625,modules:corrected.data.study.sizing.moduleCount,inverterBrand:'Inversor confirmado',inverterModel:'Inversor 5 kW',inverterPower:5,inverterQuantity:1,installedKwp:corrected.data.study.sizing.installedDcPowerWp/1000,annualGeneration:corrected.data.study.sizing.annualGenerationKwh,annualSavings:corrected.data.study.financial.annualSavings.value,investment:24000,pricingMode:'LEGACY'};
  const converted=await request('/api/admin/diagnostics/'+diagnosticId+'/convert','POST',{proposal},admin);assert.equal(converted.status,201);assert.equal(converted.data.diagnostic.status,'PROPOSAL_GENERATED');assert.ok(converted.data.record.id.startsWith('PT-'));
  const convertedAgain=await request('/api/admin/diagnostics/'+diagnosticId+'/convert','POST',{proposal},admin);assert.equal(convertedAgain.status,200);assert.equal(convertedAgain.data.duplicate,true);
  const sent=await request('/api/admin/diagnostics/'+diagnosticId,'PATCH',{status:'PROPOSAL_SENT'},admin);assert.equal(sent.status,200);
  const another=await request('/api/public/diagnostics','POST',{...input,submissionKey:'diagnostic-attachment-01',attachment:{filename:'fatura.pdf',contentType:'application/pdf',data:'data:application/pdf;base64,JVBERi0xLjQK'}});assert.equal(another.status,201);
  const anotherRow=(await request('/api/admin/diagnostics','GET',undefined,admin)).data.items.find(item=>item.protocol===another.data.protocol);assert.ok(anotherRow);
  const download=await fetch(base+'/api/admin/diagnostics/'+anotherRow.id+'/attachment',{headers:{cookie:admin}});assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/pdf');
  const forbidden=await fetch(base+'/api/admin/diagnostics/'+anotherRow.id+'/attachment');assert.equal(forbidden.status,401);
  const notValidated=await request('/api/admin/diagnostics/config','PUT',{financing:{displayActive:true,conditionsVerified:false}},admin);assert.equal(notValidated.status,400);
  const expired=await request('/api/admin/diagnostics/config','PUT',{validUntil:'2020-01-01',financing:{displayActive:true,conditionsVerified:true,partnerName:'Parceiro conferido',conditionsText:'Condições conferidas',firstDueDate:'2027-01-10'}},admin);assert.equal(expired.status,200);
  const expiredPublic=await request('/api/public/diagnostics/config');assert.equal(expiredPublic.data.campaignActive,false);assert.equal(expiredPublic.data.financing.active,false);assert.equal(expiredPublic.data.financing.text,'Consulte opções de financiamento para o seu projeto.');
});
