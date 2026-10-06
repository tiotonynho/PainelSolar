const crypto=require('node:crypto');

const PRODUCT_CATEGORIES=Object.freeze([
  'MODULE','INVERTER','MICROINVERTER','STRUCTURE','PROTECTION','CABLE','CONNECTOR','BATTERY','ACCESSORY'
]);
const INTEGRATION_TYPES=Object.freeze([
  'api','b2b','json','xml','feed','csv','excel','structured_import','authorized_automation','scraping','manual'
]);
const STOCK_STATUSES=Object.freeze(['AVAILABLE','LOW_STOCK','OUT_OF_STOCK','UNKNOWN','IN_STOCK','PRE_ORDER']);

const fail=message=>Object.assign(new Error(message),{code:'CATALOG_VALIDATION'});
const clone=value=>JSON.parse(JSON.stringify(value));

function text(value,label,{required=true,max=255}={}){
  if(value===undefined||value===null){if(required)throw fail(`${label} é obrigatório.`);return null;}
  if(typeof value!=='string')throw fail(`${label} deve ser texto.`);
  const result=value.trim();
  if(required&&!result)throw fail(`${label} é obrigatório.`);
  if(result.length>max)throw fail(`${label} excede ${max} caracteres.`);
  return result||null;
}

function booleanValue(value,label,defaultValue=true){
  if(value===undefined)return defaultValue;
  if(typeof value!=='boolean')throw fail(`${label} deve ser booleano.`);
  return value;
}

function timestamp(value,label,defaultValue=Date.now()){
  if(value===undefined||value===null)return defaultValue;
  const result=Number(value);
  if(!Number.isInteger(result)||result<0)throw fail(`${label} deve ser um timestamp em milissegundos.`);
  return result;
}

function identifier(value,label){
  const result=text(value,label,{max:120});
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(result))throw fail(`${label} possui formato inválido.`);
  return result;
}

function slug(value){
  const result=text(value,'Slug',{max:120})
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  if(!result)throw fail('Slug é obrigatório.');
  return result;
}

function nonNegative(value,label,{integer=false,nullable=false}={}){
  if(value===undefined||value===null||value===''){
    if(nullable)return null;
    throw fail(`${label} é obrigatório.`);
  }
  const result=Number(value);
  if(!Number.isFinite(result)||result<0||(integer&&!Number.isInteger(result)))throw fail(`${label} deve ser um número não negativo${integer?' inteiro':''}.`);
  return result;
}

function specifications(value){
  if(value===undefined||value===null)return {};
  let result=value;
  if(typeof value==='string'){
    try{result=JSON.parse(value);}catch{throw fail('Especificações devem ser JSON válido.');}
  }
  if(typeof result!=='object'||Array.isArray(result))throw fail('Especificações devem ser um objeto.');
  return clone(result);
}

function normalizeSupplier(input={},options={}){
  const now=options.now===undefined?Date.now():options.now;
  const integrationType=String(input.integrationType||'manual').trim().toLowerCase();
  if(!INTEGRATION_TYPES.includes(integrationType))throw fail('Tipo de integração inválido.');
  return {
    id:identifier(input.id||crypto.randomUUID(),'ID do fornecedor'),
    name:text(input.name,'Nome do fornecedor',{max:160}),
    slug:slug(input.slug||input.name),
    active:booleanValue(input.active,'Fornecedor ativo'),
    integrationType,
    createdAt:timestamp(input.createdAt,'createdAt',now),
    updatedAt:timestamp(input.updatedAt,'updatedAt',now)
  };
}

function normalizeProduct(input={},options={}){
  const now=options.now===undefined?Date.now():options.now;
  const category=text(input.category,'Categoria',{max:40});
  if(!PRODUCT_CATEGORIES.includes(category))throw fail('Categoria de produto inválida.');
  return {
    id:identifier(input.id||crypto.randomUUID(),'ID do produto'),
    category,
    manufacturer:text(input.manufacturer,'Fabricante',{max:160}),
    model:text(input.model,'Modelo',{max:160}),
    description:text(input.description,'Descrição',{required:false,max:1000}),
    specifications:specifications(input.specifications),
    active:booleanValue(input.active,'Produto ativo'),
    createdAt:timestamp(input.createdAt,'createdAt',now),
    updatedAt:timestamp(input.updatedAt,'updatedAt',now)
  };
}

function normalizeSupplierProduct(input={},options={}){
  const now=options.now===undefined?Date.now():options.now;
  const supplierUrl=text(input.supplierUrl,'URL do fornecedor',{required:false,max:2000});
  if(supplierUrl&&!/^https?:\/\//i.test(supplierUrl))throw fail('URL do fornecedor deve começar com http:// ou https://.');
  return {
    id:identifier(input.id||crypto.randomUUID(),'ID do vínculo fornecedor-produto'),
    supplierId:identifier(input.supplierId,'ID do fornecedor'),
    productId:identifier(input.productId,'ID do produto'),
    supplierSku:text(input.supplierSku,'SKU do fornecedor',{max:160}),
    supplierName:text(input.supplierName,'Nome do produto no fornecedor',{required:false,max:255}),
    supplierUrl,
    active:booleanValue(input.active,'Produto do fornecedor ativo'),
    lastSyncAt:input.lastSyncAt===undefined||input.lastSyncAt===null?null:timestamp(input.lastSyncAt,'lastSyncAt'),
    createdAt:timestamp(input.createdAt,'createdAt',now),
    updatedAt:timestamp(input.updatedAt,'updatedAt',now)
  };
}

function normalizeSupplierOffer(input={},options={}){
  const now=options.now===undefined?Date.now():options.now;
  const stockStatus=input.stockStatus||'UNKNOWN';
  if(!STOCK_STATUSES.includes(stockStatus))throw fail('Status de estoque inválido.');
  const currency=(input.currency||'BRL').toString().trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw fail('Moeda deve usar código ISO de 3 letras.');
  return {
    id:identifier(input.id||crypto.randomUUID(),'ID da oferta'),
    supplierProductId:identifier(input.supplierProductId,'ID do produto do fornecedor'),
    price:nonNegative(input.price,'Preço',{nullable:true}),
    currency,
    stockStatus,
    stockQuantity:nonNegative(input.stockQuantity,'Quantidade em estoque',{integer:true,nullable:true}),
    leadTimeDays:nonNegative(input.leadTimeDays,'Prazo de entrega',{integer:true,nullable:true}),
    validUntil:input.validUntil===undefined||input.validUntil===null?null:timestamp(input.validUntil,'validUntil'),
    capturedAt:timestamp(input.capturedAt,'capturedAt',now),
    createdAt:timestamp(input.createdAt,'createdAt',now),
    updatedAt:timestamp(input.updatedAt,'updatedAt',now)
  };
}

function normalizePriceHistory(input={},options={}){
  const now=options.now===undefined?Date.now():options.now;
  const currency=(input.currency||'BRL').toString().trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw fail('Moeda deve usar código ISO de 3 letras.');
  const supplierProductId=input.supplierProductId?identifier(input.supplierProductId,'ID do produto do fornecedor'):null;
  const supplierKitId=input.supplierKitId?identifier(input.supplierKitId,'ID do kit do fornecedor'):null;
  if((supplierProductId===null)===(supplierKitId===null))throw fail('O histórico deve referenciar um produto ou um kit do fornecedor.');
  return {
    id:identifier(input.id||crypto.randomUUID(),'ID do histórico de preço'),
    supplierProductId,
    supplierKitId,
    price:nonNegative(input.price,'Preço'),
    currency,
    capturedAt:timestamp(input.capturedAt,'capturedAt',now)
  };
}

module.exports={
  PRODUCT_CATEGORIES,INTEGRATION_TYPES,STOCK_STATUSES,
  normalizeSupplier,normalizeProduct,normalizeSupplierProduct,normalizeSupplierOffer,normalizePriceHistory,
  specifications,clone,identifier,slugify:slug,text,booleanValue,timestamp,nonNegative
};
