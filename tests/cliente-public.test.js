const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createServer}=require('../server');

const generation=[520,480,510,470,430,400,420,470,490,520,510,530];
const proposal={clientName:'Maria Souza',document:'12345678901',address:'Rua A, 10',city:'Alfenas',state:'MG',installation:'3001234567',connection:'50',moduleBrand:'Marca M',moduleModel:'Modelo M',modulePower:550,modules:8,area:20.6,inverterBrand:'Marca I',inverterModel:'Modelo I',inverterType:'string',inverterPower:5,inverterQuantity:1,kitCost:9000,margin:49,installationRate:23.08,engineeringRate:12,taxRate:0,investment:18000,installedKwp:4.4,generation,annualGeneration:generation.reduce((a,b)=>a+b,0),annualSavings:6000,tariff:1.1,hsp:5.1,performance:.74};

test('link do cliente entrega a proposta visual sem expor custos internos',async t=>{
  const dir=path.join(__dirname,'tmp','cliente-'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});
  const server=createServer({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  async function request(route,method='GET',data,cookie=''){
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',cookie},body:data?JSON.stringify(data):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const admin=(await request('/api/auth/setup','POST',{name:'Antônio Cruz',email:'admin@example.com',password:'admin-password-123'})).cookie;
  const created=await request('/api/records','POST',{proposal},admin);assert.equal(created.status,201);
  const token=created.data.publicPath.split('#')[1];
  const page=await fetch(base+'/cliente.html');assert.equal(page.status,200);assert.match(await page.text(),/cliente\.css/);
  assert.equal((await fetch(base+'/cliente.css')).status,200);

  const pub=(await request('/api/public/'+token)).data,p=pub.proposal;
  assert.equal(pub.status,'pending');
  assert.deepEqual(p.generation,generation);
  assert.equal(p.modules,8);assert.equal(p.modulePower,550);assert.equal(p.connection,'Bifásica');assert.equal(p.installation,'3001234567');
  assert.equal(p.customerPrice,p.investment);assert.ok(Math.abs(p.payback-p.customerPrice/6000)<1e-9);
  assert.equal(p.consultant,'Antônio Cruz');
  assert.ok(p.expiresAt>Date.now());assert.ok(p.issuedAt);
  assert.equal(p.hybrid,false);assert.equal(p.battery,null);
  for(const internal of ['kitCost','margin','installationRate','engineeringRate','taxRate','pricingSnapshot','pricingBreakdown','equipmentCost','document','hsp','performance'])
    assert.ok(!(internal in p),'campo interno exposto: '+internal);

  const accepted=await request('/api/public/'+token+'/accept','POST',{name:'Maria Souza',document:'123.456.789-01',email:'maria@example.com',confirmed:true});
  assert.equal(accepted.status,200);
  const after=(await request('/api/public/'+token)).data;
  assert.equal(after.status,'accepted');assert.equal(after.proposal.expiresAt,null);
});
