const FREIGHT_STATUSES=Object.freeze(['KNOWN','UNKNOWN','UNAVAILABLE']);

const isFiniteNumber=value=>typeof value==='number'&&Number.isFinite(value);

function normalizePostalCode(value){
  if(value===undefined||value===null||value==='')return null;
  const result=String(value).replace(/\D/g,'');
  if(!/^\d{8}$/.test(result))throw Object.assign(new Error('CEP deve possuir oito dígitos.'),{code:'FREIGHT_VALIDATION'});
  return result;
}

function timestamp(value,label,{nullable=true}={}){
  if(value===undefined||value===null){if(nullable)return null;throw Object.assign(new Error(`${label} é obrigatório.`),{code:'FREIGHT_VALIDATION'});}
  const result=Number(value);
  if(!Number.isInteger(result)||result<0)throw Object.assign(new Error(`${label} deve ser timestamp válido.`),{code:'FREIGHT_VALIDATION'});
  return result;
}

function normalizeFreightQuote(input={}){
  const status=(input.status||'UNKNOWN').toString().trim().toUpperCase();
  if(!FREIGHT_STATUSES.includes(status))throw Object.assign(new Error('Status de frete inválido.'),{code:'FREIGHT_VALIDATION'});
  const supplierId=String(input.supplierId||'').trim();
  const supplierKitId=String(input.supplierKitId||'').trim();
  if(!supplierId||!supplierKitId)throw Object.assign(new Error('FreightQuote deve possuir supplierId e supplierKitId.'),{code:'FREIGHT_VALIDATION'});
  const postalCode=normalizePostalCode(input.postalCode);
  let cost=null;
  if(status==='KNOWN'){
    if(!isFiniteNumber(input.cost)||input.cost<0)throw Object.assign(new Error('FreightQuote conhecido deve possuir custo válido.'),{code:'FREIGHT_VALIDATION'});
    cost=input.cost;
  }
  let estimatedDays=null;
  if(input.estimatedDays!==undefined&&input.estimatedDays!==null){
    if(!Number.isInteger(input.estimatedDays)||input.estimatedDays<0)throw Object.assign(new Error('estimatedDays deve ser inteiro não negativo.'),{code:'FREIGHT_VALIDATION'});
    estimatedDays=input.estimatedDays;
  }
  return {
    supplierId,supplierKitId,postalCode,status,cost,
    estimatedDays:status==='KNOWN'?estimatedDays:null,
    quotedAt:timestamp(input.quotedAt,'quotedAt'),
    expiresAt:timestamp(input.expiresAt,'expiresAt'),
    createdAt:timestamp(input.createdAt,'createdAt')
  };
}

function quoteMatches(quote,{supplierId,supplierKitId,postalCode}){
  if(quote.supplierId!==supplierId||quote.supplierKitId!==supplierKitId)return false;
  if(quote.postalCode===null)return true;
  return postalCode!==null&&quote.postalCode===postalCode;
}

function findFreightQuote(quotes=[],criteria={},now=Date.now()){
  const postalCode=normalizePostalCode(criteria.postalCode);
  const matching=quotes.filter(quote=>quoteMatches(quote,{...criteria,postalCode}));
  const active=matching.filter(quote=>quote.expiresAt===null||quote.expiresAt>now)
    .sort((left,right)=>(right.quotedAt||0)-(left.quotedAt||0));
  if(active.length)return {quote:active[0],reason:null};
  if(matching.length)return {quote:null,reason:'FREIGHT_QUOTE_EXPIRED'};
  return {quote:null,reason:null};
}

module.exports={FREIGHT_STATUSES,normalizePostalCode,normalizeFreightQuote,findFreightQuote};
