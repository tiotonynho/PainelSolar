const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createServer}=require('../server');

test('leads das páginas públicas aparecem para a equipe com situação, responsável e histórico',async t=>{
  const dir=path.join(__dirname,'tmp','leads-'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});
  const server=createServer({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  async function request(route,method='GET',data,cookie=''){
    const response=await fetch(base+'/api/'+route,{method,headers:{'Content-Type':'application/json',cookie},body:data?JSON.stringify(data):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const portico=await request('leads','POST',{name:'Maria Souza',email:'maria@example.com',phone:'(35) 99999-1111',city:'Alfenas/MG',company:'portico',source:'portico-page'});
  assert.equal(portico.status,201);assert.match(portico.data.protocol,/^PS-/);
  const gotex=await request('leads','POST',{name:'João Lima',email:'joao@example.com',phone:'35988887777',city:'Varginha',state:'MG',company:'gotex',service:'Manutenção',notes:'Inversor desligando',privacyAccepted:true});
  assert.equal(gotex.status,201);
  assert.equal((await request('leads','POST',{name:'X',email:'invalido',city:'',company:'portico'})).status,400);
  assert.equal((await request('admin/leads')).status,401);

  const admin=(await request('auth/setup','POST',{name:'Admin',email:'admin@example.com',password:'admin-password-123'})).cookie;
  const list=await request('admin/leads','GET',null,admin);
  assert.equal(list.status,200);assert.equal(list.data.total,2);assert.equal(list.data.newCount,2);
  assert.equal(list.data.items[0].name,'João Lima');assert.equal(list.data.items[0].status,'NEW');
  assert.equal((await request('admin/leads?company=gotex','GET',null,admin)).data.total,1);
  assert.equal((await request('admin/leads?q=maria','GET',null,admin)).data.total,1);
  const mariaId=list.data.items.find(item=>item.name==='Maria Souza').id,joaoId=list.data.items.find(item=>item.name==='João Lima').id;

  const added=await request('users','POST',{name:'Vendedor',email:'seller@example.com',password:'temporary-password',role:'seller'},admin);
  const sellerId=added.data.user.id;
  let seller=(await request('login','POST',{email:'seller@example.com',password:'temporary-password'})).cookie;
  seller=(await request('auth/password','POST',{currentPassword:'temporary-password',password:'seller-password-123'},seller)).cookie;

  const other=await request('users','POST',{name:'Outro',email:'other@example.com',password:'temporary-password',role:'seller'},admin);
  const assigned=await request('admin/leads/'+joaoId,'PATCH',{assignedTo:other.data.user.id,status:'CONTACTED',note:'Ligar amanhã'},admin);
  assert.equal(assigned.status,200);assert.equal(assigned.data.status,'CONTACTED');assert.equal(assigned.data.assignedName,'Outro');
  assert.equal(assigned.data.history.length,1);assert.equal(assigned.data.history[0].note,'Ligar amanhã');

  const sellerList=await request('admin/leads','GET',null,seller);
  assert.equal(sellerList.data.total,1,'vendedor vê apenas leads livres ou próprios');
  assert.equal((await request('admin/leads/'+joaoId,'GET',null,seller)).status,404);
  assert.equal((await request('admin/leads/'+mariaId,'PATCH',{assignedTo:other.data.user.id},seller)).status,403);
  const taken=await request('admin/leads/'+mariaId,'PATCH',{assignedTo:sellerId},seller);
  assert.equal(taken.status,200);assert.equal(taken.data.assignedTo,sellerId);
  const won=await request('admin/leads/'+mariaId,'PATCH',{status:'WON'},seller);assert.equal(won.data.status,'WON');
  assert.equal((await request('admin/leads/'+mariaId,'PATCH',{status:'INVALID'},seller)).status,400);
  assert.equal((await request('admin/leads','GET',null,seller)).data.total,1);
  assert.equal((await request('admin/leads?status=OPEN','GET',null,seller)).data.total,0);
  assert.equal((await request('admin/leads?status=OPEN','GET',null,admin)).data.total,1);
});
