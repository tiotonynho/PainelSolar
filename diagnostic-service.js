'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const SolarSizingEngine=require('./solar-sizing-engine');
const KitMatchingEngine=require('./kit-matching-engine');
const ProcurementEngine=require('./procurement-engine');
const {priceProposal}=require('./proposal-pricing-service');

const STATUS=Object.freeze(['RECEIVED','DATA_PENDING','STUDY_GENERATED','IN_REVIEW','PROPOSAL_GENERATED','PROPOSAL_SENT','CLOSED']);
const PROFILE=Object.freeze(['RESIDENTIAL','COMMERCIAL']);
const CONNECTIONS=Object.freeze(['MONOPHASIC','BIPHASIC','TRIPHASIC','NOT_SURE']);
const ROOFS=Object.freeze(['TILE','METAL','FIBROCEMENT','FLAT','OTHER','NOT_SURE']);
const SHADES=Object.freeze(['NONE','PARTIAL','SIGNIFICANT','NOT_SURE']);
const INCREASES=Object.freeze(['NONE','IN_1_YEAR','IN_2_TO_3_YEARS','NOT_SURE']);
const FINANCING=Object.freeze(['YES','NO','NOT_SURE']);
const DEFAULT_PERFORMANCE_RATIO=.8;
const DEFAULT_MODULE_POWER_WP=625;
const MAX_ATTACHMENT_BYTES=4*1024*1024;
const ALLOWED_UTM=['source','medium','campaign','term','content'];

const fail=(message,status=400,details)=>Object.assign(new Error(message),{status,details});
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const cleanText=(value,label,{required=false,max=180}={})=>{
  const result=value===undefined||value===null?'':String(value).trim();
  if(required&&!result)throw fail(`${label} é obrigatório.`);
  if(result.length>max)throw fail(`${label} excede o limite permitido.`);
  return result||null;
};
const enumValue=(value,allowed,label,{required=false}={})=>{
  const result=value===undefined||value===null?'':String(value).trim().toUpperCase();
  if(!result&&!required)return null;
  if(!allowed.includes(result))throw fail(`${label} é inválido.`);
  return result;
};
const positiveNumber=(value,label,{required=false,max=100000000}={})=>{
  if(value===undefined||value===null||value===''){
    if(required)throw fail(`${label} é obrigatório.`);
    return null;
  }
  const result=typeof value==='number'?value:Number(String(value).replace(',','.'));
  if(!finite(result)||result<=0||result>max)throw fail(`${label} deve ser maior que zero e válido.`);
  return result;
};
const optionalNumber=(value,label,{min=0,max=100000000}={})=>{
  if(value===undefined||value===null||value==='')return null;
  const result=typeof value==='number'?value:Number(String(value).replace(',','.'));
  if(!finite(result)||result<min||result>max)throw fail(`${label} é inválido.`);
  return result;
};
const isoDate=value=>{
  if(value===undefined||value===null||value==='')return null;
  const result=String(value).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!finite(Date.parse(`${result}T00:00:00Z`)))throw fail('Data da campanha é inválida.');
  return result;
};
const parse=value=>value?JSON.parse(value):null;
const json=value=>JSON.stringify(value??null);
const clone=value=>value===null||value===undefined?value:JSON.parse(JSON.stringify(value));
const safeFilename=value=>String(value||'fatura').replace(/[^a-z0-9._-]+/gi,'_').slice(0,120)||'fatura';
const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();

function normalizeWhatsApp(value){
  const result=String(value||'').replace(/\D/g,'');
  if(!/^\d{10,15}$/.test(result))throw fail('Informe um WhatsApp válido com DDD.');
  return result;
}

function normalizeUtm(input){
  const result={};
  const source=input&&typeof input==='object'?input:{};
  for(const key of ALLOWED_UTM){
    const value=cleanText(source[key],`UTM ${key}`,{max:120});
    if(value)result[key]=value.replace(/[<>]/g,'');
  }
  return result;
}

function normalizeSubmission(input,{correction=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Dados do diagnóstico inválidos.');
  const output={};
  if(!correction||Object.prototype.hasOwnProperty.call(input,'name'))output.name=cleanText(input.name,'Nome',{required:!correction,max:120});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'whatsapp'))output.whatsapp=normalizeWhatsApp(input.whatsapp);
  if(!correction||Object.prototype.hasOwnProperty.call(input,'city'))output.city=cleanText(input.city,'Cidade',{required:!correction,max:120});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'state')){
    output.state=cleanText(input.state,'UF',{required:!correction,max:2});
    if(output.state&&!/^[A-Za-z]{2}$/.test(output.state))throw fail('Informe uma UF válida.');
    if(output.state)output.state=output.state.toUpperCase();
  }
  if(!correction||Object.prototype.hasOwnProperty.call(input,'profile'))output.profile=enumValue(input.profile,PROFILE,'Perfil',{required:!correction});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'averageConsumptionKwh'))output.averageConsumptionKwh=positiveNumber(input.averageConsumptionKwh,'Consumo médio em kWh',{max:1000000});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'averageBillAmount'))output.averageBillAmount=positiveNumber(input.averageBillAmount,'Valor médio da conta',{max:100000000});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'propertyStatus'))output.propertyStatus=enumValue(input.propertyStatus,['OWNED','RENTED'],'Situação do imóvel',{required:!correction});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'email')){
    output.email=cleanText(input.email,'E-mail',{max:254});
    if(output.email&&!/^([^\s@]+)@([^\s@]+)\.([^\s@]+)$/.test(output.email))throw fail('E-mail inválido.');
  }
  if(!correction||Object.prototype.hasOwnProperty.call(input,'distributor'))output.distributor=cleanText(input.distributor,'Distribuidora',{max:120});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'connectionType'))output.connectionType=enumValue(input.connectionType,CONNECTIONS,'Tipo de ligação',{required:false});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'roofType'))output.roofType=enumValue(input.roofType,ROOFS,'Tipo de cobertura',{required:false});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'shade'))output.shade=enumValue(input.shade,SHADES,'Sombra',{required:false});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'consumptionIncrease'))output.consumptionIncrease=enumValue(input.consumptionIncrease,INCREASES,'Previsão de aumento de consumo',{required:false});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'financingInterest'))output.financingInterest=enumValue(input.financingInterest,FINANCING,'Interesse em financiamento',{required:false});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'notes'))output.notes=cleanText(input.notes,'Observações',{max:2000});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'marketingOptIn'))output.marketingOptIn=input.marketingOptIn===true;
  if(!correction||Object.prototype.hasOwnProperty.call(input,'privacyAccepted'))output.privacyAccepted=input.privacyAccepted===true;
  if(!correction||Object.prototype.hasOwnProperty.call(input,'tariffPerKwh'))output.tariffPerKwh=positiveNumber(input.tariffPerKwh,'Tarifa por kWh',{max:10000});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'hsp'))output.hsp=positiveNumber(input.hsp,'HSP',{max:20});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'performanceRatio'))output.performanceRatio=optionalNumber(input.performanceRatio,'Performance ratio',{min:.01,max:1});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'modulePowerWp'))output.modulePowerWp=positiveNumber(input.modulePowerWp,'Potência do módulo',{max:2000});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'availabilityConsumptionKwh'))output.availabilityConsumptionKwh=optionalNumber(input.availabilityConsumptionKwh,'Disponibilidade de consumo',{max:10000});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'voltage'))output.voltage=cleanText(input.voltage,'Tensão',{max:80});
  if(!correction||Object.prototype.hasOwnProperty.call(input,'postalCode')){
    output.postalCode=cleanText(input.postalCode,'CEP',{max:12});
    if(output.postalCode&&!/^\d{5}-?\d{3}$/.test(output.postalCode))throw fail('CEP inválido.');
  }
  if(!correction){
    if(output.averageConsumptionKwh===null&&output.averageBillAmount===null)throw fail('Informe o consumo médio em kWh, o valor médio da conta ou os dois.');
    if(output.privacyAccepted!==true)throw fail('Confirme a finalidade do uso dos dados.');
  }
  return output;
}

function validateAttachment(attachment){
  if(!attachment)return null;
  if(!attachment||typeof attachment!=='object')throw fail('Anexo inválido.');
  const filename=safeFilename(attachment.filename);
  const mime=String(attachment.contentType||'').toLowerCase();
  if(!['application/pdf','image/jpeg','image/png'].includes(mime))throw fail('A conta deve estar em PDF, JPG ou PNG.');
  const raw=String(attachment.data||'').replace(/^data:[^;]+;base64,/i,'').replace(/\s/g,'');
  if(!raw||!/^[a-z0-9+/]+={0,2}$/i.test(raw))throw fail('Anexo inválido.');
  let buffer;
  try{buffer=Buffer.from(raw,'base64');}catch{throw fail('Anexo inválido.');}
  if(!buffer.length||buffer.length>MAX_ATTACHMENT_BYTES)throw fail('O anexo deve ter no máximo 4 MB.');
  const isPdf=mime==='application/pdf'&&buffer.subarray(0,5).toString('ascii')==='%PDF-';
  const isPng=mime==='image/png'&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isJpg=mime==='image/jpeg'&&buffer.subarray(0,3).equals(Buffer.from([255,216,255]));
  if(!isPdf&&!isPng&&!isJpg)throw fail('O conteúdo do anexo não corresponde ao formato informado.');
  return {filename,mime,buffer,size:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex')};
}

function normalizeConfig(input,current){
  const base=current||{
    identity:{brandName:'Pórtico Solar Energy',headline:'Descubra quanto você pode economizar com energia solar.',subheadline:'Diagnóstico gratuito para residências e empresas, com análise preliminar baseada nos dados informados.',ctaText:'Quero meu diagnóstico gratuito',privacyText:'Usaremos seus dados somente para analisar seu consumo, entrar em contato sobre este diagnóstico e preparar uma proposta quando fizer sentido. A autorização para comunicações futuras é opcional.',steps:['Você informa os dados da conta e do imóvel.','Nossa equipe confere as premissas e prepara um estudo preliminar.','Depois da revisão, avaliamos o próximo passo com você.']},
    cities:[],validFrom:null,validUntil:null,
    financing:{displayActive:false,conditionsVerified:false,partnerName:null,conditionsText:null,entryText:null,termMonths:null,graceMonths:null,firstDueDate:null,requiredFinancialInfo:[]}
  };
  const identityInput=input.identity||{};
  const identity={
    brandName:cleanText(identityInput.brandName??base.identity.brandName,'Nome da marca',{required:true,max:120}),
    headline:cleanText(identityInput.headline??base.identity.headline,'Título da campanha',{required:true,max:180}),
    subheadline:cleanText(identityInput.subheadline??base.identity.subheadline,'Texto de apoio',{required:true,max:320}),
    ctaText:cleanText(identityInput.ctaText??base.identity.ctaText,'CTA',{required:true,max:80}),
    privacyText:cleanText(identityInput.privacyText??base.identity.privacyText,'Texto de privacidade',{required:true,max:800}),
    steps:Array.isArray(identityInput.steps)?identityInput.steps.map((item,index)=>cleanText(item,`Etapa ${index+1}`,{required:true,max:180})).slice(0,5):base.identity.steps
  };
  const cities=Array.isArray(input.cities)?input.cities.map(value=>cleanText(value,'Cidade atendida',{required:true,max:120})).filter(Boolean).slice(0,100):clone(base.cities)||[];
  const validFrom=isoDate(input.validFrom===undefined?base.validFrom:input.validFrom);
  const validUntil=isoDate(input.validUntil===undefined?base.validUntil:input.validUntil);
  if(validFrom&&validUntil&&validUntil<validFrom)throw fail('O fim da campanha deve ser posterior ao início.');
  const old=base.financing||{};const financingInput=input.financing||{};
  const financing={
    displayActive:financingInput.displayActive===undefined?old.displayActive===true:financingInput.displayActive===true,
    conditionsVerified:financingInput.conditionsVerified===undefined?old.conditionsVerified===true:financingInput.conditionsVerified===true,
    partnerName:cleanText(financingInput.partnerName===undefined?old.partnerName:financingInput.partnerName,'Parceiro financeiro',{max:160}),
    conditionsText:cleanText(financingInput.conditionsText===undefined?old.conditionsText:financingInput.conditionsText,'Condições financeiras',{max:600}),
    entryText:cleanText(financingInput.entryText===undefined?old.entryText:financingInput.entryText,'Entrada',{max:160}),
    termMonths:financingInput.termMonths===undefined?old.termMonths??null:optionalNumber(financingInput.termMonths,'Prazo',{min:1,max:240}),
    graceMonths:financingInput.graceMonths===undefined?old.graceMonths??null:optionalNumber(financingInput.graceMonths,'Carência',{min:0,max:120}),
    firstDueDate:isoDate(financingInput.firstDueDate===undefined?old.firstDueDate:financingInput.firstDueDate),
    requiredFinancialInfo:Array.isArray(financingInput.requiredFinancialInfo)?financingInput.requiredFinancialInfo.map(item=>cleanText(item,'Informação financeira',{required:true,max:120})).slice(0,20):clone(old.requiredFinancialInfo)||[]
  };
  if(financing.displayActive&&(!financing.conditionsVerified||!financing.partnerName||!financing.conditionsText||!financing.firstDueDate))throw fail('Ative a divulgação somente após preencher e validar as condições financeiras.');
  return {identity,cities,validFrom,validUntil,financing};
}

function createDiagnosticService(db,{dataDir,solarHsp,kitService,catalogService,commercialConfigService}={}){
  const attachmentDir=path.join(dataDir||'.data','diagnostic-attachments');
  fs.mkdirSync(attachmentDir,{recursive:true});
  const rowById=id=>db.prepare('SELECT * FROM campaign_diagnostics WHERE id=?').get(id);
  const configRow=()=>db.prepare('SELECT * FROM campaign_diagnostic_config WHERE id=?').get('default');
  const configFromRow=row=>row&&({identity:parse(row.identity_json),cities:parse(row.cities_json)||[],validFrom:row.valid_from||null,validUntil:row.valid_until||null,financing:parse(row.financing_json)||{},updatedAt:row.updated_at,updatedBy:row.updated_by});
  const effectiveData=record=>({...record.originalData,...(record.correctedData||{})});
  const pendingLabel=(code,label,detail)=>({code,label,detail:detail||null});
  const activeCampaign=now=>{
    const config=configFromRow(configRow());
    const date=new Date(now).toISOString().slice(0,10);
    return {config,active:!!config&&(!config.validFrom||date>=config.validFrom)&&(!config.validUntil||date<=config.validUntil)};
  };
  const financingPublic=(config,active)=>{
    const f=config?.financing||{};
    const verified=active&&f.displayActive===true&&f.conditionsVerified===true&&f.partnerName&&f.conditionsText&&f.firstDueDate;
    return verified?{active:true,partnerName:f.partnerName,conditionsText:f.conditionsText,entryText:f.entryText||null,termMonths:f.termMonths??null,firstDueDate:f.firstDueDate}: {active:false,text:'Consulte opções de financiamento para o seu projeto.'};
  };
  function publicCampaignConfig(){
    const {config,active}=activeCampaign(Date.now());
    return {identity:config.identity,cities:config.cities,validFrom:config.validFrom,validUntil:config.validUntil,financing:financingPublic(config,active),campaignActive:active};
  }
  function adminCampaignConfig(){
    const {config,active}=activeCampaign(Date.now());
    return {...clone(config),campaignActive:active,publicFinancing:financingPublic(config,active)};
  }
  function saveConfig(input,actorId){
    const current=configFromRow(configRow()),next=normalizeConfig(input,current),now=Date.now();
    db.prepare('UPDATE campaign_diagnostic_config SET identity_json=?,cities_json=?,valid_from=?,valid_until=?,financing_json=?,updated_at=?,updated_by=? WHERE id=?').run(json(next.identity),json(next.cities),next.validFrom,next.validUntil,json(next.financing),now,actorId||null,'default');
    return configFromRow(configRow());
  }
  function history(diagnosticId,event,{fromStatus=null,toStatus=null,actorId=null,details={}}={}){
    db.prepare('INSERT INTO campaign_diagnostic_history(id,diagnostic_id,event,from_status,to_status,actor_id,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),diagnosticId,event,fromStatus,toStatus,actorId,json(details),Date.now());
  }
  function attachmentRows(id){
    return db.prepare('SELECT id,original_name,mime_type,size_bytes,sha256,created_at FROM campaign_diagnostic_attachments WHERE diagnostic_id=? ORDER BY created_at').all(id).map(row=>({id:row.id,originalName:row.original_name,mimeType:row.mime_type,sizeBytes:row.size_bytes,sha256:row.sha256,createdAt:row.created_at,downloadPath:`/api/admin/diagnostics/${id}/attachment`}));
  }
  function fromRow(row,{detail=false}={}){
    if(!row)return null;
    const value={id:row.id,protocol:row.protocol,source:row.source,utm:parse(row.utm_json)||{},name:row.contact_name,whatsapp:row.whatsapp,city:row.city,state:row.state,profile:row.profile,averageConsumptionKwh:row.average_consumption_kwh===null?null:Number(row.average_consumption_kwh),averageBillAmount:row.average_bill_amount===null?null:Number(row.average_bill_amount),status:row.status,pending:parse(row.pending_json)||[],hasStudy:!!row.study_json,study:parse(row.study_json),assignedTo:row.assigned_to||null,clientRecordId:row.client_record_id||null,proposalId:row.proposal_id||null,receivedAt:row.received_at,updatedAt:row.updated_at,attachments:attachmentRows(row.id)};
    if(detail){
      value.originalData=parse(row.original_data_json);value.correctedData=parse(row.corrected_data_json);value.notes=parse(row.notes_json)||[];
      value.history=db.prepare('SELECT id,event,from_status,to_status,actor_id,details_json,created_at FROM campaign_diagnostic_history WHERE diagnostic_id=? ORDER BY created_at DESC,id DESC').all(row.id).map(item=>({id:item.id,event:item.event,fromStatus:item.from_status,toStatus:item.to_status,actorId:item.actor_id,details:parse(item.details_json)||{},createdAt:item.created_at}));
    }
    return value;
  }
  function get(id,{detail=true}={}){return fromRow(rowById(id),{detail});}
  function requireRecord(id){const record=get(id,{detail:true});if(!record)throw fail('Diagnóstico não encontrado.',404);return record;}
  function create(input,{ip,attachment}={}){
    const original=normalizeSubmission(input);
    const campaign=activeCampaign(Date.now());
    if(!campaign.active)throw fail('A campanha não está disponível neste período.',410);
    if(campaign.config.cities.length&&!campaign.config.cities.some(city=>fold(city.split('/')[0])===fold(original.city)))throw fail('Ainda não atendemos esta cidade nesta campanha.',422);
    const submissionKey=cleanText(input.submissionKey,'Chave de envio',{required:true,max:80});
    if(!/^[A-Za-z0-9_-]{8,80}$/.test(submissionKey))throw fail('Chave de envio inválida.');
    const source=cleanText(input.source||'portico-diagnostico','Origem',{required:true,max:80});
    const utm=normalizeUtm(input.utm);
    const file=validateAttachment(attachment);
    const existing=db.prepare('SELECT id FROM campaign_diagnostics WHERE submission_key=?').get(submissionKey);
    if(existing)return {record:get(existing.id,{detail:false}),duplicate:true};
    const id='DG-'+new Date().getFullYear()+'-'+crypto.randomBytes(5).toString('hex').toUpperCase();
    const protocol='PS-'+new Date().getFullYear()+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();
    const now=Date.now();
    const initialPending=[];if(original.averageConsumptionKwh===null)initialPending.push(pendingLabel('CONSUMPTION_KWH_PENDING','Consumo em kWh pendente','O valor da conta pode ser conferido manualmente, mas não será convertido automaticamente em kWh.'));
    if(original.connectionType==='NOT_SURE'||!original.connectionType)initialPending.push(pendingLabel('CONNECTION_TYPE_PENDING','Tipo de ligação pendente'));
    let storedPath=null;
    try{
      if(file){
        const storageName=crypto.randomUUID()+path.extname(file.filename).toLowerCase();storedPath=path.join(attachmentDir,storageName);fs.writeFileSync(storedPath,file.buffer,{flag:'wx'});
        db.exec('BEGIN IMMEDIATE');
        db.prepare('INSERT INTO campaign_diagnostics(id,protocol,submission_key,source,utm_json,contact_name,whatsapp,city,state,profile,average_consumption_kwh,average_bill_amount,original_data_json,status,pending_json,notes_json,received_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,protocol,submissionKey,source,json(utm),original.name,original.whatsapp,original.city,original.state,original.profile,original.averageConsumptionKwh,original.averageBillAmount,json(original),'RECEIVED',json(initialPending),json([]),now,now);
        db.prepare('INSERT INTO campaign_diagnostic_attachments(id,diagnostic_id,storage_name,original_name,mime_type,size_bytes,sha256,created_at) VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,storageName,file.filename,file.mime,file.size,file.sha256,now);
        history(id,'RECEIVED',{details:{source,hasAttachment:true,utmKeys:Object.keys(utm)}});db.exec('COMMIT');
      }else{
        db.exec('BEGIN IMMEDIATE');
        db.prepare('INSERT INTO campaign_diagnostics(id,protocol,submission_key,source,utm_json,contact_name,whatsapp,city,state,profile,average_consumption_kwh,average_bill_amount,original_data_json,status,pending_json,notes_json,received_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,protocol,submissionKey,source,json(utm),original.name,original.whatsapp,original.city,original.state,original.profile,original.averageConsumptionKwh,original.averageBillAmount,json(original),'RECEIVED',json(initialPending),json([]),now,now);
        history(id,'RECEIVED',{details:{source,hasAttachment:false,utmKeys:Object.keys(utm)}});db.exec('COMMIT');
      }
    }catch(error){try{db.exec('ROLLBACK');}catch{}if(storedPath)try{fs.rmSync(storedPath,{force:true});}catch{}if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return {record:get(db.prepare('SELECT id FROM campaign_diagnostics WHERE submission_key=?').get(submissionKey)?.id,{detail:false}),duplicate:true};throw error;}
    return {record:get(id,{detail:false}),duplicate:false};
  }
  function list(filters={}){
    const page=Math.max(1,Number(filters.page)||1),pageSize=Math.min(100,Math.max(1,Number(filters.pageSize)||20));
    const where=[],params=[];
    if(filters.status){where.push('status=?');params.push(String(filters.status).toUpperCase());}
    if(filters.profile){where.push('profile=?');params.push(String(filters.profile).toUpperCase());}
    if(filters.city){where.push('LOWER(city)=LOWER(?)');params.push(String(filters.city).trim());}
    if(filters.from){where.push('received_at>=?');params.push(Date.parse(String(filters.from)+'T00:00:00Z'));}
    if(filters.to){where.push('received_at<?');params.push(Date.parse(String(filters.to)+'T00:00:00Z')+86400000);}
    if(filters.q){where.push('(protocol LIKE ? OR contact_name LIKE ? OR whatsapp LIKE ?)');const query='%'+String(filters.q).slice(0,120)+'%';params.push(query,query,query);}
    const clause=where.length?' WHERE '+where.join(' AND '):'';
    const total=db.prepare('SELECT count(*) AS n FROM campaign_diagnostics'+clause).get(...params).n;
    const rows=db.prepare('SELECT * FROM campaign_diagnostics'+clause+' ORDER BY received_at DESC,id DESC LIMIT ? OFFSET ?').all(...params,pageSize,(page-1)*pageSize);
    return {items:rows.map(row=>fromRow(row)),total,page,pageSize};
  }
  function validateStatus(status){const value=String(status||'').toUpperCase();if(!STATUS.includes(value))throw fail('Situação inválida.');return value;}
  function update(id,patch,actorId){
    const row=rowById(id);if(!row)throw fail('Diagnóstico não encontrado.',404);
    const current=fromRow(row,{detail:true});let nextData=current.correctedData?{...current.originalData,...current.correctedData}:null;
    let nextStatus=row.status,assignedTo=row.assigned_to||null,pending=JSON.parse(row.pending_json)||[],notes=JSON.parse(row.notes_json)||[],events=[];
    if(patch.status!==undefined){nextStatus=validateStatus(patch.status);if(nextStatus==='PROPOSAL_SENT'&&!row.proposal_id)throw fail('Uma proposta precisa estar vinculada antes de marcar como enviada.',409);}
    if(patch.assignedTo!==undefined){assignedTo=patch.assignedTo||null;events.push('ASSIGNED');}
    if(patch.correctedData!==undefined){const correction=normalizeSubmission(patch.correctedData,{correction:true});nextData={...(nextData||current.originalData),...correction};events.push('DATA_CORRECTED');}
    if(Array.isArray(patch.pending)){const autoPending=pending.filter(item=>item.code!=='MANUAL_PENDING');const manualPending=patch.pending.map(item=>cleanText(item,'Pendência',{required:true,max:240})).slice(0,30).map(label=>pendingLabel('MANUAL_PENDING',label));pending=[...autoPending,...manualPending];events.push('PENDING_UPDATED');}
    if(patch.note!==undefined){const note=cleanText(patch.note,'Observação',{required:true,max:2000});notes.push({id:crypto.randomUUID(),text:note,authorId:actorId||null,createdAt:new Date().toISOString()});events.push('NOTE_ADDED');}
    const now=Date.now();
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('UPDATE campaign_diagnostics SET corrected_data_json=?,status=?,pending_json=?,notes_json=?,assigned_to=?,updated_at=? WHERE id=?').run(nextData?json({...nextData,privacyAccepted:undefined}):null,nextStatus,json(pending),json(notes),assignedTo,now,id);
      const event=nextStatus!==row.status?'STATUS_CHANGED':events[0]||'UPDATED';history(id,event,{fromStatus:row.status,toStatus:nextStatus,actorId,details:{events,hasCorrections:!!patch.correctedData,pendingCount:pending.length}});db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return get(id,{detail:true});
  }
  function manualPendingFor(data){
    const pending=[];
    if(data.averageConsumptionKwh===null)pending.push(pendingLabel('CONSUMPTION_KWH_PENDING','Consumo médio em kWh pendente','O diagnóstico precisa de kWh para dimensionar o sistema.'));
    if(data.connectionType==='NOT_SURE'||!data.connectionType)pending.push(pendingLabel('CONNECTION_TYPE_PENDING','Tipo de ligação pendente'));
    if(data.roofType==='NOT_SURE'||!data.roofType)pending.push(pendingLabel('ROOF_TYPE_PENDING','Cobertura pendente','A cobertura será conferida na avaliação do imóvel.'));
    return pending;
  }
  async function buildStudy(id,{actorId,corrections={}}={}){
    const current=requireRecord(id);const data=normalizeSubmission(corrections,{correction:true});
    const merged={...(current.correctedData?{...current.originalData,...current.correctedData}:current.originalData),...data};
    let pending=manualPendingFor(merged),hspResult=null,sizing=null,matching=null,procurement=null;
    const premises=[{key:'performanceRatio',value:merged.performanceRatio??DEFAULT_PERFORMANCE_RATIO,classification:merged.performanceRatio===undefined?'assumed':'confirmed',source:merged.performanceRatio===undefined?'Parâmetro existente do app comercial':'Correção administrativa'},{key:'modulePowerWp',value:merged.modulePowerWp??DEFAULT_MODULE_POWER_WP,classification:merged.modulePowerWp===undefined?'assumed':'confirmed',source:merged.modulePowerWp===undefined?'Parâmetro existente do app comercial':'Correção administrativa'}];
    if(merged.hsp!==undefined&&merged.hsp!==null)hspResult={hsp:merged.hsp,source:'Correção administrativa'};
    else if(merged.city&&merged.state){try{hspResult=await solarHsp(merged.state,merged.city);}catch{pending.push(pendingLabel('SOLAR_RESOURCE_PENDING','Recurso solar regional pendente','Não foi possível consultar a fonte regional agora; a equipe deve conferir antes de usar o resultado.'));}}
    else pending.push(pendingLabel('LOCATION_PENDING','Localização pendente'));
    if(merged.averageConsumptionKwh!==null&&hspResult?.hsp&&merged.connectionType&&merged.connectionType!=='NOT_SURE'){
      const connection=merged.connectionType;
      try{
        sizing=SolarSizingEngine.calculateSizing({monthlyConsumptionKwh:merged.averageConsumptionKwh,connectionType:connection,hsp:Number(hspResult.hsp),performanceRatio:Number(merged.performanceRatio??DEFAULT_PERFORMANCE_RATIO),modulePowerWp:Number(merged.modulePowerWp??DEFAULT_MODULE_POWER_WP),...(merged.availabilityConsumptionKwh===null||merged.availabilityConsumptionKwh===undefined?{}:{availabilityConsumptionKwh:merged.availabilityConsumptionKwh}),monthlyHspProfile:hspResult.monthly?Object.values(hspResult.monthly):undefined});
        premises.push({key:'hsp',value:sizing.hsp,classification:hspResult.source==='Correção administrativa'?'confirmed':'estimated',source:hspResult.source||'NASA POWER + Open-Meteo'});
        if(kitService&&merged.voltage){
          const kits=kitService.listKitsForMatching();
          matching=KitMatchingEngine.matchKits({requiredDcPowerWp:sizing.requiredDcPowerWp,installedDcPowerWp:sizing.installedDcPowerWp,modulePowerWp:sizing.modulePowerWp,moduleCount:sizing.moduleCount,connectionType:sizing.connectionType,voltage:merged.voltage},kits,{logger:{info(){},warn(){}}});
          if(matching.matches.length&&catalogService){
            procurement=ProcurementEngine.procure({compatibleKits:matching.matches,kits,suppliers:catalogService.listSuppliers(),destinationPostalCode:merged.postalCode,freightQuotes:[]},{logger:{info(){},warn(){}}});
            if(procurement.requiresReview)pending.push(pendingLabel('PROCUREMENT_REVIEW_REQUIRED','Procurement requer revisão','Preço, estoque ou frete não foram confirmados para uma proposta definitiva.'));
          }
        }else if(!merged.voltage)pending.push(pendingLabel('VOLTAGE_PENDING','Tensão pendente','Informe a tensão para avaliar kits compatíveis.'));
      }catch(error){pending.push(pendingLabel('SIZING_REVIEW_REQUIRED','Dimensionamento requer revisão',error.message));}
    }
    if(merged.averageBillAmount===null)pending.push(pendingLabel('BILL_AMOUNT_PENDING','Valor médio da conta pendente','Sem o valor informado da conta não é possível estimar a conta residual.'));
    if(merged.tariffPerKwh===undefined||merged.tariffPerKwh===null)pending.push(pendingLabel('TARIFF_PENDING','Tarifa por kWh pendente','A equipe deve confirmar a tarifa aplicável antes de estimar economia financeira.'));
    let investment=null;
    if(procurement?.bestOption&&!procurement.requiresReview){
      const commercialConfig=commercialConfigService?.getActive?.();
      if(commercialConfig){
        try{
          const priced=priceProposal({pricingMode:'STANDARD',pricingSource:'PROCUREMENT',selectionMode:'AUTO',equipmentCost:procurement.bestOption.equipmentPrice,freightCost:procurement.bestOption.freightCost,freightStatus:procurement.bestOption.freightStatus,freightRequired:true},{config:commercialConfig,procurementResult:procurement,now:Date.now()});
          if(priced.result.pricingComplete===true&&priced.proposal.customerPrice!==null)investment={value:priced.proposal.customerPrice,classification:'estimated',source:'ProposalPricingService',commercialConfigVersion:commercialConfig.version};
          else pending.push(pendingLabel('PRICING_REVIEW_REQUIRED','Precificação requer revisão','A configuração comercial não permitiu um preço completo.'));
        }catch{pending.push(pendingLabel('PRICING_REVIEW_REQUIRED','Precificação requer revisão','A configuração comercial ou a oferta precisa ser conferida.'));}
      }else pending.push(pendingLabel('PRICING_CONFIG_PENDING','Configuração comercial pendente','Ative uma configuração comercial validada antes de estimar investimento.'));
    }
    const monthlyGeneration=sizing?.monthlyGenerationKwh||null;
    const annualGeneration=sizing?.estimatedAnnualGenerationKwh??null;
    let annualSavings=null,monthlySavings=null,residual=null;
    if(sizing&&merged.tariffPerKwh!==null&&merged.tariffPerKwh!==undefined){const compensable=Math.min(annualGeneration,sizing.compensableConsumptionKwh*12);annualSavings=compensable*Number(merged.tariffPerKwh);monthlySavings=annualSavings/12;if(merged.averageBillAmount!==null&&monthlySavings<merged.averageBillAmount)residual=merged.averageBillAmount-monthlySavings;else if(merged.averageBillAmount!==null)pending.push(pendingLabel('RESIDUAL_REVIEW_REQUIRED','Conta residual requer revisão','A economia estimada alcança o valor informado; encargos, demanda e custos fixos não foram modelados.'));}
    const study={version:1,generatedAt:new Date().toISOString(),classification:sizing?'PRELIMINARY':'PARTIAL',engine:'SolarSizingEngine',sourceData:{original:true,corrected:!!current.correctedData||Object.keys(corrections).length>0},reference:{averageConsumptionKwh:merged.averageConsumptionKwh??null,averageBillAmount:merged.averageBillAmount??null,connectionType:merged.connectionType??null},hsp:hspResult?{value:Number(hspResult.hsp),source:hspResult.source||'NASA POWER + Open-Meteo',matchedCity:hspResult.matchedCity||null,monthly:hspResult.monthly||null}:null,sizing:sizing?{averageConsumptionKwh:sizing.averageConsumptionKwh,compensableConsumptionKwh:sizing.compensableConsumptionKwh,requiredDcPowerWp:sizing.requiredDcPowerWp,installedDcPowerWp:sizing.installedDcPowerWp,moduleCount:sizing.moduleCount,modulePowerWp:sizing.modulePowerWp,monthlyGenerationKwh:sizing.monthlyGenerationKwh,annualGenerationKwh:sizing.estimatedAnnualGenerationKwh,classification:'estimated'}:null,financial:{monthlySavings:monthlySavings===null?null:{value:monthlySavings,classification:'estimated'},annualSavings:annualSavings===null?null:{value:annualSavings,classification:'estimated'},residualAccount:residual===null?null:{value:residual,classification:'estimated',note:'Não inclui necessariamente encargos, demanda ou custos fixos.'},investment,note:investment?'Estimativa baseada em Procurement e configuração comercial vigentes; depende de revisão humana.':'Não há investimento definitivo neste estudo. Preços, frete e estoque dependem da revisão comercial.'},matching:matching?{engine:'KitMatchingEngine',matches:matching.matches.slice(0,5),rejectedCount:matching.rejected.length}:null,procurement:procurement?{engine:'ProcurementEngine',bestOption:procurement.bestOption?{kitId:procurement.bestOption.kitId,equipmentPrice:procurement.bestOption.equipmentPrice,freightCost:procurement.bestOption.freightCost,freightStatus:procurement.bestOption.freightStatus,stockStatus:procurement.bestOption.stockStatus,validUntil:procurement.bestOption.offerValidUntil}:null,requiresReview:procurement.requiresReview,warnings:procurement.warnings}:null,premises,pending:[...new Map(pending.map(item=>[item.code,item])).values()]};
    const status=study.pending.length?'DATA_PENDING':'STUDY_GENERATED';const row=rowById(id),now=Date.now();
    db.exec('BEGIN IMMEDIATE');
    try{
      const mergedCorrection=Object.keys(corrections).length?{...(current.correctedData||{}),...data}:current.correctedData;
      db.prepare('UPDATE campaign_diagnostics SET corrected_data_json=?,study_json=?,status=?,pending_json=?,updated_at=? WHERE id=?').run(mergedCorrection?json(mergedCorrection):null,json(study),status,json(study.pending),now,id);
      history(id,'STUDY_GENERATED',{fromStatus:row.status,toStatus:status,actorId,details:{classification:study.classification,pendingCodes:study.pending.map(item=>item.code),engines:['SolarSizingEngine',...(matching?['KitMatchingEngine']:[]),...(procurement?['ProcurementEngine']:[])]}});db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return get(id,{detail:true});
  }
  function assign(id,userId,actorId,userLookup){
    if(userId){const target=userLookup?.(userId);if(!target||!target.active)throw fail('Responsável não encontrado ou inativo.',404);}
    return update(id,{assignedTo:userId||null},actorId);
  }
  function markProposal(id,proposalId,actorId){
    const row=rowById(id);if(!row)throw fail('Diagnóstico não encontrado.',404);if(row.proposal_id) return get(id,{detail:true});
    db.prepare('UPDATE campaign_diagnostics SET proposal_id=?,status=?,updated_at=? WHERE id=?').run(proposalId,'PROPOSAL_GENERATED',Date.now(),id);history(id,'PROPOSAL_GENERATED',{fromStatus:row.status,toStatus:'PROPOSAL_GENERATED',actorId,details:{proposalId}});return get(id,{detail:true});
  }
  function attachment(id){
    const row=db.prepare('SELECT * FROM campaign_diagnostic_attachments WHERE diagnostic_id=? ORDER BY created_at LIMIT 1').get(id);if(!row)throw fail('Anexo não encontrado.',404);const filePath=path.join(attachmentDir,row.storage_name);if(!fs.existsSync(filePath))throw fail('Arquivo do anexo não encontrado.',404);return {path:filePath,mimeType:row.mime_type,filename:safeFilename(row.original_name)};
  }
  return {STATUS,publicCampaignConfig,adminCampaignConfig,saveConfig,create,list,get,update,buildStudy,assign,markProposal,attachment,normalizeSubmission,validateAttachment,normalizeConfig,MAX_ATTACHMENT_BYTES};
}

module.exports={createDiagnosticService,STATUS,PROFILE,CONNECTIONS,MAX_ATTACHMENT_BYTES,normalizeSubmission,validateAttachment,normalizeConfig};
