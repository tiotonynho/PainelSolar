const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createServer}=require('../server');

const proposal={clientName:'Cliente Orçamento',document:'12345678901',address:'Rua Teste, 10',city:'Alfenas',state:'MG',quoteType:'services',investment:450,additionalServices:[{field:'serviceMaintenance',label:'Manutenção geral',quantity:1,unitValue:450,total:450}]};

test('orçamentos: edição preserva código e histórico; aceite exige nova versão',async t=>{
  const server=createServer({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'solar-budgets-'))});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Admin Teste',email:'admin@example.com',password:'admin-password-123'})});
  const admin=setup.headers.get('set-cookie').split(';')[0];
  async function request(route,method='GET',body,cookie=admin){
    const response=await fetch(base+'/api/'+route,{method,headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  }
  const created=await request('records','POST',{proposal});assert.equal(created.status,201);
  const initial=created.data;
  const update={proposal:{...proposal,address:'Rua Atualizada, 20',investment:900,additionalServices:[{...proposal.additionalServices[0],quantity:2,total:900}]},previousRevision:1};
  assert.equal((await request('records/'+initial.id+'/proposal','PUT',{...update,previousRevision:0})).status,409);
  const edited=await request('records/'+initial.id+'/proposal','PUT',update);assert.equal(edited.status,200);
  assert.equal(edited.data.id,initial.id);assert.equal(edited.data.publicPath,initial.publicPath);
  assert.equal(edited.data.proposalRevision,2);assert.equal(edited.data.proposal.investment,900);
  assert.deepEqual(edited.data.proposalHistory[0].proposal,initial.proposal);
  assert.equal((await request('records/'+initial.id+'/proposal','PUT',update)).status,409);
  const races=await Promise.all([request('records/'+initial.id+'/proposal','PUT',{...update,previousRevision:2}),request('records/'+initial.id+'/proposal','PUT',{...update,previousRevision:2})]);
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  const token=initial.publicPath.split('#')[1];
  const consent={name:proposal.clientName,document:proposal.document,email:'cliente@example.com',confirmed:true};
  assert.equal((await request('public/'+token+'/accept','POST',consent,'')).status,200);
  const accepted=(await request('records/'+initial.id)).data;
  assert.equal((await request('records/'+initial.id+'/proposal','PUT',{...update,previousRevision:3})).status,409);
  const copy=await request('records','POST',{proposal:edited.data.proposal,sourceRecordId:initial.id});assert.equal(copy.status,201);
  assert.notEqual(copy.data.id,initial.id);assert.equal(copy.data.sourceRecordId,initial.id);assert.equal(copy.data.acceptance,null);
  assert.deepEqual((await request('records/'+initial.id)).data,accepted);
  const publicRecord=(await request('public/'+token,'GET',null,'')).data;
  assert.equal(publicRecord.proposal.investment,900);assert.equal(publicRecord.proposal.address,'Rua Atualizada, 20');

  await request('users','POST',{name:'Vendedor',email:'seller@example.com',password:'temporary-password',role:'seller'});
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'seller@example.com',password:'temporary-password'})});
  let seller=login.headers.get('set-cookie').split(';')[0];
  const password=await fetch(base+'/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json',cookie:seller},body:JSON.stringify({currentPassword:'temporary-password',password:'seller-password-123'})});
  seller=password.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('records/'+copy.data.id+'/proposal','PUT',update,seller)).status,404);
  assert.equal((await request('records','POST',{proposal,sourceRecordId:initial.id},seller)).status,404);
  assert.equal((await request('records/'+copy.data.id+'/proposal','PUT',update,'')).status,401);
});
