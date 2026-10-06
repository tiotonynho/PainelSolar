const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDatabase}=require('./db');
const Core=require('./contract-core');
const {createAuth}=require('./auth');
const {createKitService}=require('./kit-service');
const {createCatalogService}=require('./catalog-service');
const {createCommercialConfigService}=require('./commercial-config-service');
const {createSupplierImportService}=require('./supplier-import-service');
const {priceProposal}=require('./proposal-pricing-service');
const {normalizeProcurementResult,PRICING_SOURCES,SELECTION_MODES}=require('./procurement-pricing-bridge');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const textValue=value=>typeof value==='string'&&value.trim();
function createServer({dataDir=path.join(__dirname,'.data'),publicUrl=process.env.PUBLIC_URL,fetchImpl=fetch}={}){
  const db=openDatabase(dataDir);
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
  const catalogService=createCatalogService(db);
  const kitService=createKitService(db);
  const pricingLogger={
    info:event=>console.info('[pricing]',event.event,event.pricingMode||'',event.commercialConfigVersion??''),
    warn:event=>console.warn('[pricing]',event.event,(event.warnings||[]).join(','))
  };
  const commercialConfigService=createCommercialConfigService(db,{logger:pricingLogger});
  const supplierImportLogger={
    info:event=>console.info('[supplier-import]',event.event,event.batchId||''),
    warn:event=>console.warn('[supplier-import]',event.event,event.batchId||'',event.error||'')
  };
  const supplierImportService=createSupplierImportService(db,{logger:supplierImportLogger});
  const configForProposal=proposal=>{
    if(String(proposal?.pricingMode||'LEGACY').toUpperCase()!=='STANDARD')return null;
    return proposal?.commercialConfigVersion
      ? commercialConfigService.getByVersion(proposal.commercialConfigVersion)
      : commercialConfigService.getActive();
  };
  const prepareProposal=({proposal,config,procurementResult,pricingSource,selectionMode,selectedOfferId,overrideReason,freightRequired,requireComplete=true})=>{
    let priced;
    const input={...(proposal||{})};
    if(pricingSource!==undefined)input.pricingSource=pricingSource;
    if(selectionMode!==undefined)input.selectionMode=selectionMode;
    if(selectedOfferId!==undefined)input.selectedOfferId=selectedOfferId;
    if(overrideReason!==undefined)input.overrideReason=overrideReason;
    try{priced=priceProposal(input,{config:config??configForProposal(input),procurementResult,pricingSource,selectionMode,selectedOfferId,overrideReason,freightRequired,now:Date.now(),logger:pricingLogger});}
    catch(error){throw fail(error.message,422);}
    if(requireComplete&&(priced.result.pricingComplete!==true||priced.proposal.customerPrice===null)){
      const warnings=priced.result.warnings?.join(', ')||'PRICING_REVIEW_REQUIRED';
      throw fail('A precificação da proposta exige revisão: '+warnings,422);
    }
    return priced;
  };
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
          const publicEvents=r.signature?(r.audit||[]).map(event=>({event:event.event,date:event.date})):[];
          return reply(200,{id:r.id,status:r.status,proposal:{quoteType:p.quoteType,clientName:p.clientName,address:p.address,city:p.city,state:p.state,installedKwp:p.installedKwp,annualGeneration:p.annualGeneration,investment:p.investment,customerPrice:p.customerPrice??p.investment,annualSavings:p.annualSavings,equipment:Core.equipment(p),services:Core.services(p)},contract:r.contract?{text:r.contract.text,revision:r.contract.revision,hash:r.contract.hash}:null,signature:r.signature||null,events:publicEvents});
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
          const accepted=Core.accept(r.proposal,{name:data.name,document:data.document,email:data.email,date:now,channel:'Link da proposta',evidence:'Aceite eletrônico pelo link individual',confirmed:true,proposalId:r.id,pricingMode:r.proposal.pricingMode||'LEGACY',commercialConfigVersion:r.proposal.commercialConfigVersion??null,customerPrice:r.proposal.customerPrice??r.proposal.investment},r.id);
          Object.assign(r,accepted);
          r.audit=[...(r.audit||[]),{event:'proposal.accepted',date:now,ip:req.socket.remoteAddress,agent:req.headers['user-agent']||'',proposalHash:hash(JSON.stringify(r.proposal)),pricingMode:r.proposal.pricingMode||'LEGACY',commercialConfigVersion:r.proposal.commercialConfigVersion??null,customerPrice:r.proposal.customerPrice??r.proposal.investment}];
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
        const requireAdmin=()=>{if(user.role!=='admin')throw fail('Acesso exclusivo do administrador.',403);};
        if(route==='/api/admin/suppliers'&&req.method==='GET'){
          requireAdmin();return reply(200,catalogService.listSuppliers());
        }
        if(route==='/api/admin/supplier-imports/preview'&&req.method==='POST'){
          requireAdmin();const data=await body(req);if(String(data.sourceType||'CSV').toUpperCase()!=='CSV')throw fail('A pré-visualização desta etapa aceita somente CSV.',422);return reply(200,supplierImportService.previewCsv(data));
        }
        if(route==='/api/admin/supplier-imports'&&req.method==='GET'){
          requireAdmin();const supplierId=url.searchParams.get('supplierId')||undefined;return reply(200,supplierImportService.listBatches(supplierId));
        }
        if(route==='/api/admin/supplier-imports'&&req.method==='POST'){
          requireAdmin();const data=await body(req);if(String(data.sourceType||'CSV').toUpperCase()!=='CSV')throw fail('Importação API requer adapter oficial configurado.',422);return reply(201,supplierImportService.createCsvImport({...data,createdBy:user.id}));
        }
        const importItemReview=route.match(/^\/api\/admin\/supplier-imports\/([A-Za-z0-9-]+)\/items\/([A-Za-z0-9-]+)$/);
        if(importItemReview&&req.method==='PATCH'){
          requireAdmin();return reply(200,supplierImportService.reviewItem(importItemReview[1],importItemReview[2],{...(await body(req)),actorId:user.id}));
        }
        const importAction=route.match(/^\/api\/admin\/supplier-imports\/([A-Za-z0-9-]+)\/(dry-run|publish|cancel|diff)$/);
        if(importAction){
          requireAdmin();const batchId=importAction[1],action=importAction[2];
          if(action==='diff'&&req.method==='GET')return reply(200,supplierImportService.getDiff(batchId));
          if(action==='dry-run'&&req.method==='POST')return reply(200,supplierImportService.dryRun(batchId));
          if(action==='publish'&&req.method==='POST')return reply(200,supplierImportService.publish(batchId,{actorId:user.id,confirmReview:(await body(req)).confirmReview===true}));
          if(action==='cancel'&&req.method==='POST')return reply(200,supplierImportService.cancel(batchId,user.id));
        }
        const importMatch=route.match(/^\/api\/admin\/supplier-imports\/([A-Za-z0-9-]+)$/);
        if(importMatch&&req.method==='GET'){
          requireAdmin();const batch=supplierImportService.getBatch(importMatch[1]);if(!batch)throw fail('Importação não encontrada.',404);return reply(200,batch);
        }
        if(route==='/api/commercial-config/active'&&req.method==='GET'){
          return reply(200,commercialConfigService.getActive());
        }
        if(route==='/api/admin/commercial-config'&&req.method==='GET'){
          requireAdmin();return reply(200,commercialConfigService.list());
        }
        if(route==='/api/admin/commercial-config'&&req.method==='POST'){
          requireAdmin();return reply(201,commercialConfigService.create(await body(req),user.id));
        }
        const commercialConfigAudit=route.match(/^\/api\/admin\/commercial-config\/audit(?:\/([A-Za-z0-9-]+))?$/);
        if(commercialConfigAudit&&req.method==='GET'){
          requireAdmin();return reply(200,commercialConfigService.audit(commercialConfigAudit[1]||null));
        }
        const commercialConfigActivate=route.match(/^\/api\/admin\/commercial-config\/([A-Za-z0-9-]+)\/activate$/);
        if(commercialConfigActivate&&req.method==='PATCH'){
          requireAdmin();return reply(200,commercialConfigService.activate(commercialConfigActivate[1],user.id));
        }
        if(route==='/api/admin/kits'&&req.method==='GET'){
          requireAdmin();return reply(200,kitService.listKits());
        }
        if(route==='/api/admin/kits'&&req.method==='POST'){
          requireAdmin();const kit=kitService.createKit(await body(req));return reply(201,kit);
        }
        const kitItemDelete=route.match(/^\/api\/admin\/kits\/([A-Za-z0-9_-]+)\/items\/([A-Za-z0-9_-]+)$/);
        if(kitItemDelete&&req.method==='DELETE'){
          requireAdmin();return reply(200,kitService.removeKitItem(kitItemDelete[1],kitItemDelete[2]));
        }
        const kitItemsPost=route.match(/^\/api\/admin\/kits\/([A-Za-z0-9_-]+)\/items$/);
        if(kitItemsPost&&req.method==='POST'){
          requireAdmin();return reply(201,kitService.addKitItem(kitItemsPost[1],await body(req)));
        }
        const supplierKitPost=route.match(/^\/api\/admin\/kits\/([A-Za-z0-9_-]+)\/supplier-kits$/);
        if(supplierKitPost&&req.method==='POST'){
          requireAdmin();return reply(201,kitService.createSupplierKit({...await body(req),kitId:supplierKitPost[1]}));
        }
        const kitMatch=route.match(/^\/api\/admin\/kits\/([A-Za-z0-9_-]+)$/);
        if(kitMatch&&req.method==='GET'){
          requireAdmin();const kit=kitService.getKit(kitMatch[1]);if(!kit)throw fail('Kit não encontrado.',404);return reply(200,kit);
        }
        if(kitMatch&&req.method==='PUT'){
          requireAdmin();return reply(200,kitService.updateKit(kitMatch[1],await body(req)));
        }
        const supplierKitMatch=route.match(/^\/api\/admin\/supplier-kits\/([A-Za-z0-9_-]+)$/);
        if(supplierKitMatch&&req.method==='PUT'){
          requireAdmin();return reply(200,kitService.updateSupplierKit(supplierKitMatch[1],await body(req)));
        }
        const supplierKitOfferPost=route.match(/^\/api\/admin\/supplier-kits\/([A-Za-z0-9_-]+)\/offers$/);
        if(supplierKitOfferPost&&req.method==='POST'){
          requireAdmin();return reply(201,kitService.createSupplierKitOffer({...await body(req),supplierKitId:supplierKitOfferPost[1]}));
        }
        const supplierKitOfferMatch=route.match(/^\/api\/admin\/supplier-kit-offers\/([A-Za-z0-9_-]+)$/);
        if(supplierKitOfferMatch&&req.method==='PUT'){
          requireAdmin();return reply(200,kitService.updateSupplierKitOffer(supplierKitOfferMatch[1],await body(req)));
        }
        if(route==='/api/solar/hsp'&&req.method==='GET'){
          return reply(200,await solarHsp((url.searchParams.get('state')||'').toUpperCase(),url.searchParams.get('city')||''));
        }
        if(route==='/api/records'&&req.method==='GET'){
          const rows=user.role==='admin'?db.prepare('SELECT body,owner_id FROM records ORDER BY rowid').all():db.prepare('SELECT body,owner_id FROM records WHERE owner_id=? ORDER BY rowid').all(user.id);
          return reply(200,rows.map(row=>({...JSON.parse(row.body),ownerId:row.owner_id})));
        }
        if(route==='/api/records'&&req.method==='POST'){
          const data=await body(req),{proposal:rawProposal,isTest=false}=data;
          auth.requireUser(req);
          const source=String(data.pricingSource??rawProposal?.pricingSource??(String(rawProposal?.pricingMode||'LEGACY').toUpperCase()==='STANDARD'?PRICING_SOURCES.MANUAL:PRICING_SOURCES.LEGACY)).toUpperCase();
          const selectionMode=String(data.selectionMode??rawProposal?.selectionMode??SELECTION_MODES.AUTO).toUpperCase();
          if(source===PRICING_SOURCES.PROCUREMENT&&selectionMode===SELECTION_MODES.MANUAL&&user.role!=='admin')throw fail('Somente administradores podem sobrescrever a selecao de aquisicao.',403);
          const procurementResult=data.procurementResult||rawProposal?.procurementResult;
          const proposal=prepareProposal({proposal:rawProposal,procurementResult,pricingSource:source,selectionMode,selectedOfferId:data.selectedOfferId??rawProposal?.selectedOfferId,overrideReason:data.overrideReason??rawProposal?.overrideReason,freightRequired:data.freightRequired,requireComplete:true});
          const pricedProposal=proposal.proposal;
          Core.accept(pricedProposal,{name:'Validação',document:'Validação',date:new Date().toISOString(),channel:'Validação',evidence:'Validação',confirmed:true},'validation');
          const token=crypto.randomBytes(32).toString('base64url'),id='PT-'+new Date().getFullYear()+'-'+crypto.randomBytes(5).toString('hex').toUpperCase();
          const procurementReview=procurementResult?{...normalizeProcurementResult(procurementResult),refreshedAt:new Date().toISOString(),actorId:user.id}:null;
          const audit=pricedProposal.pricingSource===PRICING_SOURCES.PROCUREMENT?[{event:'procurement.selected',date:new Date().toISOString(),actorId:user.id,pricingSource:pricedProposal.pricingSource,selectionMode:pricedProposal.selectionMode||null,procurementSnapshot:pricedProposal.pricingSnapshot?.procurementSnapshot||null}]:[];
          const r={id,proposal:pricedProposal,procurementReview,status:'pending',isTest:isTest===true,acceptance:null,contract:null,pricingHistory:[],audit,expiresAt:Date.now()+3*86400000,publicPath:'/cliente.html#'+token};
          db.prepare('INSERT INTO records(id,token,body,owner_id) VALUES (?,?,?,?)').run(id,hash(token),JSON.stringify(r),user.id);return reply(201,r);
        }
        if(route==='/api/records/test'&&req.method==='DELETE'){
          if(user.role!=='admin')throw fail('Acesso exclusivo do administrador.',403);
          return reply(200,{ok:true,deleted:deleteTestRecords()});
        }
        const procurementRefreshMatch=route.match(/^\/api\/records\/([A-Z0-9-]+)\/procurement$/);
        if(procurementRefreshMatch&&req.method==='POST'){
          requireAdmin();
          const r=ownedRecord(procurementRefreshMatch[1],user);
          if(r.status!=='pending'||r.acceptance)throw fail('Propostas aceitas ou contratadas nao podem sofrer refresh de procurement.',409);
          const data=await body(req),rawResult=data.procurementResult||data;
          let procurementResult;
          try{procurementResult=normalizeProcurementResult(rawResult);}catch(error){throw fail(error.message,422);}
          r.procurementReview={...procurementResult,refreshedAt:new Date().toISOString(),actorId:user.id};
          r.audit=[...(r.audit||[]),{event:'procurement.refreshed',date:new Date().toISOString(),actorId:user.id,bestOption:r.procurementReview.bestOption?{kitId:r.procurementReview.bestOption.kitId,supplierId:r.procurementReview.bestOption.supplierId,supplierKitOfferId:r.procurementReview.bestOption.supplierKitOfferId}:null}];
          save(r);return reply(200,r);
        }
        const pricingMatch=route.match(/^\/api\/records\/([A-Z0-9-]+)\/pricing$/);
        if(pricingMatch&&req.method==='POST'){
          requireAdmin();
          const r=ownedRecord(pricingMatch[1],user);
          if(r.status!=='pending'||r.acceptance)throw fail('Somente propostas pendentes podem ser recalculadas explicitamente.',409);
          const data=await body(req),{procurementResult:bodyProcurementResult,reason,...pricingData}=data;
          const previous=r.proposal?.pricingSnapshot||null;
          const nextInput={...r.proposal,...pricingData};
          const source=String(pricingData.pricingSource??r.proposal.pricingSource??(r.proposal.pricingMode||'LEGACY')).toUpperCase();
          const selectionMode=String(pricingData.selectionMode??r.proposal.selectionMode??SELECTION_MODES.AUTO).toUpperCase();
          if(source===PRICING_SOURCES.PROCUREMENT&&selectionMode===SELECTION_MODES.MANUAL&&!textValue(pricingData.overrideReason??r.proposal.overrideReason))throw fail('overrideReason e obrigatorio para override manual.',422);
          const procurementResult=bodyProcurementResult||r.procurementReview;
          const priced=prepareProposal({proposal:nextInput,procurementResult,pricingSource:source,selectionMode,selectedOfferId:pricingData.selectedOfferId,overrideReason:pricingData.overrideReason,freightRequired:pricingData.freightRequired,requireComplete:true});
          if(bodyProcurementResult)r.procurementReview={...normalizeProcurementResult(bodyProcurementResult),refreshedAt:new Date().toISOString(),actorId:user.id};
          r.pricingHistory=[...(r.pricingHistory||[]),{changedAt:new Date().toISOString(),reason:reason||'REPRICING_EXPLICIT',customerPrice:r.proposal.customerPrice??r.proposal.investment,pricingSnapshot:previous}];
          r.proposal=priced.proposal;
          r.audit=[...(r.audit||[]),{event:'proposal.repriced',date:new Date().toISOString(),actorId:user.id,pricingSource:r.proposal.pricingSource||null,selectionMode:r.proposal.selectionMode||null,procurementSnapshot:r.proposal.pricingSnapshot?.procurementSnapshot||null,previousCustomerPrice:r.pricingHistory.at(-1).customerPrice,customerPrice:r.proposal.customerPrice,commercialConfigVersion:r.proposal.commercialConfigVersion??null}];
          save(r);return reply(200,r);
        }
        const archiveMatch=route.match(/^\/api\/records\/([A-Z0-9-]+)\/archive$/);
        if(archiveMatch&&req.method==='PATCH'){
          const r=ownedRecord(archiveMatch[1],user);
          if(r.status!=='pending'||r.acceptance)throw fail('Somente propostas enviadas e ainda não aceitas podem ser arquivadas.',409);
          r.status='archived';r.archivedAt=new Date().toISOString();save(r);return reply(200,r);
        }
        const deleteMatch=route.match(/^\/api\/records\/([A-Z0-9-]+)$/);
        if(deleteMatch&&req.method==='GET')return reply(200,ownedRecord(deleteMatch[1],user));
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
      const files=['index.html','app.js','styles.css','theme-portico.css','contracts.css','contracts.js','contract-template.js','contract-core.js','api-client.js','auth-ui.js','auth.css','commercial-config-ui.js','supplier-import-ui.js','cliente.html','cliente.js','localities.js','solar-sizing-engine.js','money.js','pricing-config.js','pricing-engine.js'];
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
