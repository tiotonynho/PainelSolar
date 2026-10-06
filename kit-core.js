const Core=require('./catalog-core');

const KIT_PHASE_TYPES=Object.freeze(['MONOPHASIC','BIPHASIC','TRIPHASIC','FLEXIBLE']);
const KIT_ITEM_ROLES=Object.freeze(['MODULE','INVERTER','MICROINVERTER','STRUCTURE','PROTECTION','CABLE','CONNECTOR','BATTERY','ACCESSORY','OTHER']);
const SUPPLIER_KIT_STOCK_STATUSES=Object.freeze(['AVAILABLE','LOW_STOCK','OUT_OF_STOCK','UNKNOWN']);

const categoryByRole={
  MODULE:['MODULE'],
  INVERTER:['INVERTER'],
  MICROINVERTER:['MICROINVERTER'],
  STRUCTURE:['STRUCTURE'],
  PROTECTION:['PROTECTION'],
  CABLE:['CABLE'],
  CONNECTOR:['CONNECTOR'],
  BATTERY:['BATTERY'],
  ACCESSORY:['ACCESSORY'],
  OTHER:null
};

function normalizeKit(input={},options={}){
  const now=options.now===undefined?Date.now():options.now;
  const phaseType=input.phaseType||'FLEXIBLE';
  if(!KIT_PHASE_TYPES.includes(phaseType))throw Object.assign(new Error('Tipo de fase do kit inválido.'),{code:'KIT_VALIDATION'});
  const nominalPowerWp=Core.nonNegative(input.nominalPowerWp,'Potência nominal do kit');
  if(nominalPowerWp<=0)throw Object.assign(new Error('Potência nominal do kit deve ser maior que zero.'),{code:'KIT_VALIDATION'});
  return {
    id:Core.identifier(input.id||require('node:crypto').randomUUID(),'ID do kit'),
    name:Core.text(input.name,'Nome do kit',{max:180}),
    slug:Core.slugify(input.slug||input.name),
    nominalPowerWp,
    phaseType,
    voltage:Core.text(input.voltage,'Tensão do kit',{max:120}),
    roofType:Core.text(input.roofType,'Tipo de telhado',{required:false,max:120}),
    description:Core.text(input.description,'Descrição do kit',{required:false,max:1000}),
    active:Core.booleanValue(input.active,'Kit ativo',false),
    createdAt:Core.timestamp(input.createdAt,'createdAt',now),
    updatedAt:Core.timestamp(input.updatedAt,'updatedAt',now)
  };
}

function normalizeKitItem(input={},options={}){
  const now=options.now===undefined?Date.now():options.now;
  const role=Core.text(input.role,'Papel do item',{max:40});
  if(!KIT_ITEM_ROLES.includes(role))throw Object.assign(new Error('Papel do item do kit inválido.'),{code:'KIT_VALIDATION'});
  const quantity=Core.nonNegative(input.quantity,'Quantidade do item',{integer:true});
  if(quantity<=0)throw Object.assign(new Error('Quantidade do item deve ser maior que zero.'),{code:'KIT_VALIDATION'});
  return {
    id:Core.identifier(input.id||require('node:crypto').randomUUID(),'ID do item do kit'),
    kitId:Core.identifier(input.kitId,'ID do kit'),
    productId:Core.identifier(input.productId,'ID do produto'),
    quantity,
    role,
    createdAt:Core.timestamp(input.createdAt,'createdAt',now),
    updatedAt:Core.timestamp(input.updatedAt,'updatedAt',now)
  };
}

function normalizeSupplierKit(input={},options={}){
  const now=options.now===undefined?Date.now():options.now;
  const supplierUrl=Core.text(input.supplierUrl,'URL do fornecedor',{required:false,max:2000});
  if(supplierUrl&&!/^https?:\/\//i.test(supplierUrl))throw Object.assign(new Error('URL do fornecedor deve começar com http:// ou https://.'),{code:'KIT_VALIDATION'});
  return {
    id:Core.identifier(input.id||require('node:crypto').randomUUID(),'ID do kit do fornecedor'),
    supplierId:Core.identifier(input.supplierId,'ID do fornecedor'),
    kitId:Core.identifier(input.kitId,'ID do kit'),
    supplierSku:Core.text(input.supplierSku,'SKU do fornecedor',{max:160}),
    supplierName:Core.text(input.supplierName,'Nome do kit no fornecedor',{required:false,max:255}),
    supplierUrl,
    active:Core.booleanValue(input.active,'Kit do fornecedor ativo'),
    lastSyncAt:input.lastSyncAt===undefined||input.lastSyncAt===null?null:Core.timestamp(input.lastSyncAt,'lastSyncAt'),
    createdAt:Core.timestamp(input.createdAt,'createdAt',now),
    updatedAt:Core.timestamp(input.updatedAt,'updatedAt',now)
  };
}

function normalizeSupplierKitOffer(input={},options={}){
  const now=options.now===undefined?Date.now():options.now;
  const stockStatus=input.stockStatus||'UNKNOWN';
  if(!SUPPLIER_KIT_STOCK_STATUSES.includes(stockStatus))throw Object.assign(new Error('Status de estoque do kit inválido.'),{code:'KIT_VALIDATION'});
  const currency=(input.currency||'BRL').toString().trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw Object.assign(new Error('Moeda deve usar código ISO de 3 letras.'),{code:'KIT_VALIDATION'});
  return {
    id:Core.identifier(input.id||require('node:crypto').randomUUID(),'ID da oferta do kit'),
    supplierKitId:Core.identifier(input.supplierKitId,'ID do kit do fornecedor'),
    price:Core.nonNegative(input.price,'Preço',{nullable:true}),
    currency,
    stockStatus,
    stockQuantity:Core.nonNegative(input.stockQuantity,'Quantidade em estoque',{integer:true,nullable:true}),
    leadTimeDays:Core.nonNegative(input.leadTimeDays,'Prazo de entrega',{integer:true,nullable:true}),
    validUntil:input.validUntil===undefined||input.validUntil===null?null:Core.timestamp(input.validUntil,'validUntil'),
    capturedAt:Core.timestamp(input.capturedAt,'capturedAt',now),
    createdAt:Core.timestamp(input.createdAt,'createdAt',now),
    updatedAt:Core.timestamp(input.updatedAt,'updatedAt',now)
  };
}

function productsById(products){
  if(products instanceof Map)return products;
  const list=Array.isArray(products)?products:Object.values(products||{});
  return new Map(list.filter(Boolean).map(product=>[product.id,product]));
}

function productForItem(item,products){
  const map=productsById(products);
  return map.get(item.productId)||item.product||null;
}

function calculateDcPower(items=[],products){
  let total=0;
  for(const item of items.filter(item=>item.role==='MODULE')){
    const product=productForItem(item,products);
    const power=Number(product?.specifications?.powerWp??product?.specifications?.power_wp??product?.powerWp);
    if(!Number.isFinite(power)||power<=0)throw new Error(`O produto ${item.productId} não possui potência de módulo válida.`);
    total+=power*Number(item.quantity);
  }
  return total;
}

function validateKit(kit,items=[],products){
  const errors=[],warnings=[];
  if(!kit?.name?.trim())errors.push('Kit deve possuir nome.');
  if(!Number.isFinite(Number(kit?.nominalPowerWp))||Number(kit.nominalPowerWp)<=0)errors.push('Kit deve possuir potência nominal válida.');
  if(kit?.active===true&&!items.length)errors.push('Kit ativo deve possuir pelo menos um componente.');
  const keys=new Set();
  for(const item of items){
    const key=`${item.kitId||kit?.id}:${item.productId}:${item.role}`;
    if(keys.has(key))errors.push(`Item duplicado: ${item.productId}/${item.role}.`);
    keys.add(key);
    if(!Number.isInteger(Number(item.quantity))||Number(item.quantity)<=0)errors.push(`Quantidade inválida para ${item.productId}.`);
    const product=productForItem(item,products);
    if(!product){errors.push(`Produto ${item.productId} não encontrado.`);continue;}
    const allowed=categoryByRole[item.role];
    if(allowed&&!allowed.includes(product.category))errors.push(`Produto ${item.productId} não é compatível com o papel ${item.role}.`);
  }
  let calculatedModulePowerWp=0;
  const moduleItems=items.filter(item=>item.role==='MODULE');
  if(moduleItems.length){
    try{calculatedModulePowerWp=calculateDcPower(items,products);}
    catch(error){warnings.push(error.message);}
    if(calculatedModulePowerWp>0&&Math.abs(Number(kit.nominalPowerWp)-calculatedModulePowerWp)>0.001){
      warnings.push(`Potência nominal (${kit.nominalPowerWp} Wp) diverge da potência calculada (${calculatedModulePowerWp} Wp).`);
    }
  }else warnings.push('Kit não possui item com papel MODULE; potência DC não calculada.');
  return {
    valid:errors.length===0,
    errors,
    warnings,
    nominalPowerWp:Number(kit?.nominalPowerWp)||0,
    calculatedModulePowerWp,
    powerDiverges:calculatedModulePowerWp>0&&Math.abs(Number(kit?.nominalPowerWp)-calculatedModulePowerWp)>0.001
  };
}

module.exports={
  KIT_PHASE_TYPES,KIT_ITEM_ROLES,SUPPLIER_KIT_STOCK_STATUSES,
  normalizeKit,normalizeKitItem,normalizeSupplierKit,normalizeSupplierKitOffer,
  calculateDcPower,validateKit
};
