const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Core=require('./contract-core');
const {createAuth}=require('./auth');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function createServer({dataDir=path.join(__dirname,'.data'),publicUrl=process.env.PUBLIC_URL,fetchImpl=fetch}={}){
  fs.mkdirSync(dataDir,{recursive:true});
  const db=new DatabaseSync(path.join(dataDir,'contracts.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, token TEXT UNIQUE, body TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS solar_hsp_cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  if(!db.prepare('PRAGMA table_info(records)').all().some(column=>column.name==='owner_id'))db.exec('ALTER TABLE records ADD COLUMN owner_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS records_owner ON records(owner_id)');
  const read=id=>{const row=db.prepare('SELECT body FROM records WHERE id=?').get(id);return row?JSON.parse(row.body):null;};
  const save=r=>db.prepare('UPDATE records SET body=? WHERE id=?').run(JSON.stringify(r),r.id);
  const fail=(message,status=400)=>Object.assign(new Error(message),{status});
  const solarMonths=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const stateNames={AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Pará',PB:'Paraíba',PR:'Paraná',PE:'Pernambuco',PI:'Piauí',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondônia',RR:'Roraima',SC:'Santa Catarina',SP:'São Paulo',SE:'Sergipe',TO:'Tocantins'};
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  async function fetchJson(url,label){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetchImpl(url,{signal:controller.signal,headers:{'User-Agent':'SolarPro/1.0'}});
      if(!response.ok)throw fail('Não foi possível consultar '+label+'.',502);
      return await response.json();
    }catch(error){
      if(error.status)throw error;
      throw fail('Não foi possível consultar '+label+'.',502);
    }finally{clearTimeout(timer);}
  }
  async function solarHsp(state,city){
    if(!/^[A-Z]{2}$/.test(state)||typeof city!=='string'||!city.trim()||city.length>120)throw fail('Informe UF e cidade válidas.');
    const key=state+'|'+normalize(city.trim());
    const cached=db.prepare('SELECT body FROM solar_hsp_cache WHERE key=?').get(key);
    if(cached)return {...JSON.parse(cached.body),cached:true};
    const geocodeUrl=new URL('https://geocoding-api.open-meteo.com/v1/search');
    geocodeUrl.search=new URLSearchParams({name:city.trim()+', '+state,count:'5',language:'pt',format:'json',countryCode:'BR'}).toString();
    const geocode=await fetchJson(geocodeUrl,'a geocodificação da cidade');
    const expectedState=normalize(stateNames[state]||state);
    const results=(geocode.results||[]).filter(item=>item.country_code==='BR');
    const sameCity=item=>normalize(item.name)===normalize(city)||normalize(item.admin2)===normalize(city);
    const sameState=item=>normalize(item.admin1)===expectedState;
    const location=results.find(item=>sameCity(item)&&sameState(item))||results.find(sameState)||results.find(sameCity)||results[0];
    if(!location)throw fail('Cidade não encontrada para cálculo de HSP.',404);
    const powerUrl=new URL('https://power.larc.nasa.gov/api/temporal/climatology/point');
    powerUrl.search=new URLSearchParams({parameters:'ALLSKY_SFC_SW_DWN',community:'RE',longitude:String(location.longitude),latitude:String(location.latitude),format:'JSON'}).toString();
    const power=await fetchJson(powerUrl,'a climatologia solar NASA POWER');
    const values=power.properties?.parameter?.ALLSKY_SFC_SW_DWN||{};
    const monthly=Object.fromEntries(solarMonths.map(month=>[month,Number(values[month])]));
    if(!solarMonths.every(month=>Number.isFinite(monthly[month]))||!Number.isFinite(Number(values.ANN)))throw fail('A API solar retornou dados incompletos.',502);
    const result={state,city:city.trim(),matchedCity:location.name,latitude:location.latitude,longitude:location.longitude,hsp:Number(values.ANN),monthly,units:power.parameters?.ALLSKY_SFC_SW_DWN?.units||'kWh/m²/dia',range:power.header?.range||'Climatologia NASA POWER',source:'NASA POWER ALLSKY_SFC_SW_DWN + Open-Meteo Geocoding'};
    db.prepare('INSERT OR REPLACE INTO solar_hsp_cache(key,body,updated_at) VALUES (?,?,?)').run(key,JSON.stringify(result),Date.now());
    return result;
  }
  function ownedRecord(id,user){
    const owner=db.prepare('SELECT owner_id FROM records WHERE id=?').get(id);
    if(!owner||(user.role!=='admin'&&owner.owner_id!==user.id))throw fail('Registro não encontrado.',404);
    const record=read(id);
    if(!record)throw fail('Registro não encontrado.',404);
    return record;
  }
  function deleteTestRecords(){
    const rows=db.prepare('SELECT id,body FROM records').all();
    const ids=rows.filter(row=>JSON.parse(row.body).isTest===true).map(row=>row.id);
    const remove=db.prepare('DELETE FROM records WHERE id=?');
    for(const id of ids)remove.run(id);
    return ids.length;
  }
  async function body(req){
    let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>500000)throw fail('Conteúdo muito grande.',413);}
    try{return JSON.parse(text||'{}');}catch{throw fail('JSON inválido.');}
  }
  const auth=createAuth(db,{publicUrl,body});
  const server=http.createServer(async(req,res)=>{
    const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    try{
      const url=new URL(req.url,'http://localhost'),route=url.pathname;
      if(req.method!=='GET'&&req.headers.origin){
        const expected=publicUrl?new URL(publicUrl).origin:'http://'+req.headers.host;
        if(req.headers.origin!==expected)throw fail('Origem não autorizada.',403);
      }
      if(await auth.handle(req,res,route,reply))return;
      if(route.startsWith('/api/public/')){
        const [,token,action]=route.match(/^\/api\/public\/([A-Za-z0-9_-]{43})(?:\/(accept|sign))?$/)||[];
        if(!token)throw fail('Link inválido.',404);
        const row=db.prepare('SELECT body FROM records WHERE token=?').get(hash(token));
        if(!row)throw fail('Link não encontrado.',404);
        let r=JSON.parse(row.body);
        if(r.status==='archived')throw fail('Proposta arquivada. Solicite um novo link.',410);
        if(r.expiresAt<Date.now()&&r.status==='pending')throw fail('Proposta expirada. Solicite um novo link.',410);
        if(req.method==='GET'&&!action){
          const p=r.proposal;
          return reply(200,{id:r.id,status:r.status,proposal:{quoteType:p.quoteType,clientName:p.clientName,address:p.address,city:p.city,state:p.state,installedKwp:p.installedKwp,annualGeneration:p.annualGeneration,investment:p.investment,annualSavings:p.annualSavings,equipment:Core.equipment(p),services:Core.services(p)},contract:r.contract?{text:r.contract.text,revision:r.contract.revision,hash:r.contract.hash}:null,signature:r.signature||null,events:r.signature?r.audit:[]});
        }
        if(req.method!=='POST')throw fail('Método não permitido.',405);
        const data=await body(req);
        r=read(r.id);
        if(r.status==='archived')throw fail('Proposta arquivada. Solicite um novo link.',410);
        if(r.expiresAt<Date.now()&&r.status==='pending')throw fail('Proposta expirada. Solicite um novo link.',410);
        for(const key of ['name','document','email'])if(typeof data[key]!=='string'||!data[key].trim()||data[key].length>250)throw fail('Preencha nome, documento e e-mail.');
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw fail('E-mail inválido.');
        if(!/^(\d{11}|\d{14})$/.test(data.document.replace(/\D/g,'')))throw fail('Informe CPF com 11 dígitos ou CNPJ com 14 dígitos.');
        if(data.confirmed!==true)throw fail('Confirme sua concordância.');
        const now=new Date().toISOString();
        if(action==='accept'){
          if(r.status!=='pending')throw fail('Esta proposta já recebeu aceite.',409);
          if(r.proposal.document&&r.proposal.document.replace(/\D/g,'')!==data.document.replace(/\D/g,''))throw fail('O documento deve corresponder ao contratante da proposta.');
          const accepted=Core.accept(r.proposal,{name:data.name,document:data.document,email:data.email,date:now,channel:'Link da proposta',evidence:'Aceite eletrônico pelo link individual',confirmed:true},r.id);
          Object.assign(r,accepted);
          r.audit=[{event:'proposal.accepted',date:now,ip:req.socket.remoteAddress,agent:req.headers['user-agent']||'',proposalHash:hash(JSON.stringify(r.proposal))}];
          save(r);return reply(200,{ok:true});
        }
        if(action==='sign'){
          if(r.status!=='prepared'||!r.contract)throw fail('Contrato indisponível para assinatura.',409);
          if(data.hash!==r.contract.hash)throw fail('O contrato mudou. Recarregue e revise a nova versão.',409);
          if(data.document.replace(/\D/g,'')!==r.acceptance.document.replace(/\D/g,''))throw fail('Informe o documento usado no aceite da proposta.');
          r.signature={name:data.name,document:data.document,email:data.email,date:now,hash:r.contract.hash,method:'Assinatura eletrônica simples por link; identidade autodeclarada'};
          r.audit.push({event:'contract.signed',date:now,ip:req.socket.remoteAddress,agent:req.headers['user-agent']||'',hash:r.contract.hash});
          r.status='signed';save(r);return reply(200,{ok:true});
        }
        throw fail('Operação inválida.',404);
      }
      if(route.startsWith('/api/')){
        const user=auth.requireUser(req);
        if(route==='/api/solar/hsp'&&req.method==='GET'){
          return reply(200,await solarHsp((url.searchParams.get('state')||'').toUpperCase(),url.searchParams.get('city')||''));
        }
        if(route==='/api/records'&&req.method==='GET'){
          const rows=user.role==='admin'?db.prepare('SELECT body,owner_id FROM records ORDER BY rowid').all():db.prepare('SELECT body,owner_id FROM records WHERE owner_id=? ORDER BY rowid').all(user.id);
          return reply(200,rows.map(row=>({...JSON.parse(row.body),ownerId:row.owner_id})));
        }
        if(route==='/api/records'&&req.method==='POST'){
          const {proposal,isTest=false}=await body(req);
          auth.requireUser(req);
          Core.accept(proposal,{name:'Validação',document:'Validação',date:new Date().toISOString(),channel:'Validação',evidence:'Validação',confirmed:true},'validation');
          const token=crypto.randomBytes(32).toString('base64url'),id='PT-'+new Date().getFullYear()+'-'+crypto.randomBytes(5).toString('hex').toUpperCase();
          const r={id,proposal,status:'pending',isTest:isTest===true,acceptance:null,contract:null,expiresAt:Date.now()+3*86400000,publicPath:'/cliente.html#'+token};
          db.prepare('INSERT INTO records(id,token,body,owner_id) VALUES (?,?,?,?)').run(id,hash(token),JSON.stringify(r),user.id);return reply(201,r);
        }
        if(route==='/api/records/test'&&req.method==='DELETE'){
          if(user.role!=='admin')throw fail('Acesso exclusivo do administrador.',403);
          return reply(200,{ok:true,deleted:deleteTestRecords()});
        }
        const archiveMatch=route.match(/^\/api\/records\/([A-Z0-9-]+)\/archive$/);
        if(archiveMatch&&req.method==='PATCH'){
          const r=ownedRecord(archiveMatch[1],user);
          if(r.status!=='pending'||r.acceptance)throw fail('Somente propostas enviadas e ainda não aceitas podem ser arquivadas.',409);
          r.status='archived';r.archivedAt=new Date().toISOString();save(r);return reply(200,r);
        }
        const deleteMatch=route.match(/^\/api\/records\/([A-Z0-9-]+)$/);
        if(deleteMatch&&req.method==='DELETE'){
          const r=ownedRecord(deleteMatch[1],user);
          if(r.acceptance||!['pending','archived'].includes(r.status))throw fail('Somente propostas sem aceite podem ser deletadas.',409);
          db.prepare('DELETE FROM records WHERE id=?').run(r.id);return reply(200,{ok:true,id:r.id});
        }
        const match=route.match(/^\/api\/records\/([A-Z0-9-]+)\/contract$/);
        if(match&&req.method==='PUT'){
          const data=await body(req);
          const r=ownedRecord(match[1],user);
          if(!r.acceptance||r.status==='signed')throw fail('Contrato sem aceite ou já assinado. Alterações não permitidas.',409);
          if(typeof data.text!=='string'||!data.text.trim()||!data.details||data.reviewed!==true)throw fail('Revise o contrato antes de publicar.');
          if(data.previousRevision!==(r.contract?.revision||0))throw fail('Outra versão foi salva. Reabra o contrato.',409);
          r.history=[...(r.history||[]),...(r.contract?[r.contract]:[])];
          r.contract={text:data.text,details:data.details,revision:(r.contract?.revision||0)+1,savedAt:new Date().toISOString(),hash:hash(data.text)};
          r.status='prepared';save(r);return reply(200,r);
        }
        throw fail('Rota não encontrada.',404);
      }
      const files=['index.html','app.js','styles.css','theme-portico.css','contracts.css','contracts.js','contract-template.js','contract-core.js','api-client.js','auth-ui.js','auth.css','cliente.html','cliente.js','localities.js'];
      const assets=['assets/portico-logo-horizontal-color.png','assets/portico-logo-horizontal-white.png','assets/portico-logo-horizontal-white-transparent.png','assets/portico-logo-vertical-color.png','assets/portico-logo-vertical-white.png','assets/portico-logo-vertical-white-transparent.png'];
      const file=route==='/'?'index.html':route.slice(1);
      if(req.method!=='GET'||(!files.includes(file)&&!assets.includes(file)))throw fail('Não encontrado.',404);
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.png')?'image/png':'text/html; charset=utf-8');
      res.end(fs.readFileSync(path.join(__dirname,file)));
    }catch(error){reply(error.status||400,{error:error.status||error.message?.startsWith('Preencha')?error.message:'Não foi possível concluir a operação. Confira os dados e tente novamente.'});}
  });
  server.on('close',()=>db.close());return server;
}
if(require.main===module){
  const port=Number(process.env.PORT||8080),host=process.env.HOST||'127.0.0.1';
  createServer().listen(port,host,()=>console.log('SolarPro em http://'+host+':'+port+' · Entre com sua conta ou configure o administrador pelo navegador local.'));
}
module.exports={createServer};
