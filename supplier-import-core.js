'use strict';

const crypto=require('node:crypto');

const STOCK_STATUSES=Object.freeze(['AVAILABLE','LOW_STOCK','OUT_OF_STOCK','UNKNOWN']);
const ENTITY_TYPES=Object.freeze(['PRODUCT_OFFER','KIT_OFFER']);
const PRODUCT_CATEGORIES=Object.freeze(['MODULE','INVERTER','MICROINVERTER','STRUCTURE','PROTECTION','CABLE','CONNECTOR','BATTERY','ACCESSORY']);
const DEFAULT_IMPORT_CONFIG=Object.freeze({priceVariationThreshold:.20,massUpdateThreshold:.50});
const aliasGroups={
  supplierSku:['supplier_sku','sku','cod_prod','cod_produto','codigo','codigo_produto'],productId:['product_id','internal_product_id'],manufacturer:['manufacturer','fabricante','marca'],model:['model','modelo'],description:['description','descricao','descrição','nome','nome_produto'],category:['category','categoria','tipo'],powerWp:['power_wp','powerwp','potencia_wp','potência_wp','potencia'],phaseType:['phase_type','phase','tipo_fase'],voltage:['voltage','tensao','tensão'],price:['price','preco','preço','valor'],currency:['currency','moeda'],stockStatus:['stock_status','stock','estoque','disponibilidade'],stockQuantity:['stock_quantity','stock_qty','saldo','quantidade','qtd'],leadTimeDays:['lead_time_days','lead_time','prazo','prazo_dias'],validUntil:['valid_until','validade','validade_ate','valid_until_date'],capturedAt:['captured_at','capturado_em','data_captura'],entityType:['entity_type','record_type','tipo_registro'],kitId:['kit_id','internal_kit_id'],kitSku:['kit_sku','sku_kit'],kitName:['kit_name','nome_kit']
};

const normalizeHeader=value=>String(value??'').replace(/^\uFEFF/,'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const text=value=>String(value??'').trim();
const unique=list=>[...new Set(list.filter(Boolean))];

function hashSource(input){return crypto.createHash('sha256').update(Buffer.isBuffer(input)?input:Buffer.from(String(input),'utf8')).digest('hex');}

function decodeCsv(input,encoding='utf8'){
  if(Buffer.isBuffer(input))return input.toString(String(encoding).toLowerCase()==='latin1'?'latin1':String(encoding).toLowerCase()==='utf16le'?'utf16le':'utf8').replace(/^\uFEFF/,'');
  return String(input??'').replace(/^\uFEFF/,'');
}

function detectDelimiter(line){
  const candidates=[',',';','\t'];let best=',';let score=-1;
  for(const delimiter of candidates){let count=0;let quoted=false;for(let i=0;i<line.length;i++){if(line[i]==='"')quoted=!quoted;else if(!quoted&&line[i]===delimiter)count++;}if(count>score){score=count;best=delimiter;}}
  return best;
}

function parseCsv(input,{delimiter,encoding='utf8'}={}){
  const source=decodeCsv(input,encoding);if(!source.trim())throw new Error('CSV vazio.');
  const separator=delimiter||detectDelimiter(source.split(/\r?\n/,1)[0]);
  if(![',',';','\t'].includes(separator))throw new Error('Separador CSV invalido.');
  const rows=[],current=[];let value='',quoted=false;
  for(let i=0;i<source.length;i++){
    const char=source[i],next=source[i+1];
    if(char==='"'){if(quoted&&next==='"'){value+='"';i++;}else quoted=!quoted;continue;}
    if(!quoted&&char===separator){current.push(value);value='';continue;}
    if(!quoted&&(char==='\n'||char==='\r')){if(char==='\r'&&next==='\n')i++;current.push(value);value='';if(current.some(item=>item!=='')){rows.push([...current]);}current.length=0;continue;}
    value+=char;
  }
  if(quoted)throw new Error('CSV possui aspas nao fechadas.');
  if(value!==''||current.length){current.push(value);if(current.some(item=>item!==''))rows.push(current);}
  if(rows.length<2)throw new Error('CSV deve possuir cabecalho e ao menos um registro.');
  const headers=rows[0].map(normalizeHeader);if(headers.some(header=>!header))throw new Error('CSV possui cabecalho vazio.');
  if(new Set(headers).size!==headers.length)throw new Error('CSV possui cabecalhos duplicados.');
  const records=rows.slice(1).map((row,index)=>Object.fromEntries(headers.map((header,column)=>[header,text(row[column])] )));
  return {headers,records,delimiter:separator};
}

function parseDecimal(value,{field='valor',decimalFormat}={}){
  const raw=text(value);if(!raw)return null;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(!/^[0-9.,\s]+$/.test(raw))throw new Error(`${field} invalido.`);
  const compact=raw.replace(/\s/g,'');
  let normalized=compact;
  const format=String(decimalFormat||'').toUpperCase();
  if(format==='BR'||format==='BRAZILIAN')normalized=compact.replace(/\./g,'').replace(',','.');
  else if(format==='INTERNATIONAL'||format==='US')normalized=compact.replace(/,/g,'');
  else if(compact.includes(',')&&compact.includes('.')){
    const comma=compact.lastIndexOf(','),dot=compact.lastIndexOf('.');
    if(comma>dot)normalized=compact.replace(/\./g,'').replace(',','.');else normalized=compact.replace(/,/g,'');
  }else if(/^\d{1,3}(,\d{3})+$/.test(compact))throw new Error(`${field} possui formato decimal ambiguo; informe decimalFormat.`);
  else if(compact.includes(','))normalized=compact.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(compact))throw new Error(`${field} possui formato decimal ambiguo; informe decimalFormat.`);
  const result=Number(normalized);if(!Number.isFinite(result))throw new Error(`${field} invalido.`);return result;
}

function parseInteger(value,{field='valor'}={}){
  if(text(value)==='')return null;const result=Number(text(value));if(!Number.isInteger(result)||result<0)throw new Error(`${field} deve ser inteiro nao negativo.`);return result;
}

function parseDate(value,{field='data',now=Date.now()}={}){
  const raw=text(value);if(!raw)return null;
  if(/^\d+$/.test(raw)){const number=Number(raw);if(Number.isInteger(number)&&number>=0)return number;}
  const brazilian=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const date=brazilian?new Date(`${brazilian[3]}-${brazilian[2]}-${brazilian[1]}T23:59:59.999Z`):new Date(raw);
  if(!Number.isFinite(date.getTime()))throw new Error(`${field} invalida.`);return date.getTime();
}

function mapField(headers,mapping,key){
  const configured=mapping?.[key];if(configured){const normalized=normalizeHeader(configured);if(headers.includes(normalized))return normalized;return null;}
  return (aliasGroups[key]||[key]).map(normalizeHeader).find(alias=>headers.includes(alias))||null;
}

function normalizeCategory(value){
  const raw=normalizeHeader(value).toUpperCase();const aliases={MODULO:'MODULE',MODULE:'MODULE',INVERSOR:'INVERTER',INVERTER:'INVERTER',MICROINVERTER:'MICROINVERTER',ESTRUTURA:'STRUCTURE',PROTECAO:'PROTECTION',CABO:'CABLE',CONECTOR:'CONNECTOR',BATERIA:'BATTERY',ACESSORIO:'ACCESSORY'};return aliases[raw]||raw;
}

function normalizeStock(value){
  const raw=normalizeHeader(value).toUpperCase();if(!raw)return 'UNKNOWN';
  if(['AVAILABLE','IN_STOCK','ESTOQUE','EM_ESTOQUE','DISPONIVEL','DISPONIVEL'].includes(raw))return 'AVAILABLE';
  if(['LOW_STOCK','BAIXO','POUCO_ESTOQUE','ULTIMAS_UNIDADES'].includes(raw))return 'LOW_STOCK';
  if(['OUT_OF_STOCK','SEM_ESTOQUE','INDISPONIVEL','ESGOTADO'].includes(raw))return 'OUT_OF_STOCK';
  if(['PRE_ORDER','PRE_VENDA','SOB_ENCOMENDA'].includes(raw))return 'UNKNOWN';
  if(['UNKNOWN','DESCONHECIDO'].includes(raw))return 'UNKNOWN';
  throw new Error('stockStatus invalido.');
}

function normalizeEntityType(value,row){
  const raw=normalizeHeader(value).toUpperCase();if(raw==='KIT'||raw==='KIT_OFFER'||raw==='OFFER_KIT')return 'KIT_OFFER';if(raw==='PRODUCT'||raw==='PRODUCT_OFFER'||raw==='OFFER')return 'PRODUCT_OFFER';return text(row.kit_id||row.kit_sku)?'KIT_OFFER':'PRODUCT_OFFER';
}

function resolveRowValue(row,headers,mapping,key){const header=mapField(headers,mapping,key);return header?row[header]:'';}

function normalizeRow(row,headers,{mapping={},defaultCurrency,decimalFormat,now=Date.now()}={}){
  const errors=[],warnings=[];const rawEntity=resolveRowValue(row,headers,mapping,'entityType');const entityType=normalizeEntityType(rawEntity,row);
  const data={entityType};
  try{data.supplierSku=text(resolveRowValue(row,headers,mapping,'supplierSku'))||null;if(!data.supplierSku)errors.push('SKU_REQUIRED');}catch{errors.push('INVALID_SKU');}
  data.productId=text(resolveRowValue(row,headers,mapping,'productId'))||null;
  data.currency=(text(resolveRowValue(row,headers,mapping,'currency'))||text(defaultCurrency)).toUpperCase()||null;
  if(!data.currency)errors.push('CURRENCY_REQUIRED');else if(!/^[A-Z]{3}$/.test(data.currency))errors.push('INVALID_CURRENCY');else if(!text(resolveRowValue(row,headers,mapping,'currency'))&&defaultCurrency)warnings.push('CURRENCY_DEFAULTED');
  try{data.price=parseDecimal(resolveRowValue(row,headers,mapping,'price'),{field:'price',decimalFormat});}catch(error){errors.push(error.message==='price possui formato decimal ambiguo; informe decimalFormat.'?'AMBIGUOUS_DECIMAL': 'INVALID_PRICE');}
  if(data.price===null)errors.push('PRICE_UNKNOWN');else if(data.price<=0)errors.push('INVALID_PRICE');
  try{data.stockQuantity=parseInteger(resolveRowValue(row,headers,mapping,'stockQuantity'),{field:'stockQuantity'});}catch{errors.push('INVALID_STOCK_QUANTITY');}
  try{data.leadTimeDays=parseInteger(resolveRowValue(row,headers,mapping,'leadTimeDays'),{field:'leadTimeDays'});}catch{errors.push('INVALID_LEAD_TIME');}
  try{data.validUntil=parseDate(resolveRowValue(row,headers,mapping,'validUntil'),{field:'validUntil',now});}catch{errors.push('INVALID_VALID_UNTIL');}
  try{data.capturedAt=parseDate(resolveRowValue(row,headers,mapping,'capturedAt'),{field:'capturedAt',now})||now;}catch{errors.push('INVALID_CAPTURED_AT');data.capturedAt=now;}
  try{data.stockStatus=normalizeStock(resolveRowValue(row,headers,mapping,'stockStatus'));}catch{errors.push('INVALID_STOCK_STATUS');data.stockStatus='UNKNOWN';}
  if(entityType==='PRODUCT_OFFER'){
    data.manufacturer=text(resolveRowValue(row,headers,mapping,'manufacturer'))||null;data.model=text(resolveRowValue(row,headers,mapping,'model'))||null;data.description=text(resolveRowValue(row,headers,mapping,'description'))||null;data.category=normalizeCategory(resolveRowValue(row,headers,mapping,'category'))||null;
    if(!data.manufacturer)errors.push('MANUFACTURER_REQUIRED');if(!data.model)errors.push('MODEL_REQUIRED');if(!data.category||!PRODUCT_CATEGORIES.includes(data.category))errors.push('INVALID_CATEGORY');
    if(data.category==='MODULE'){
      try{data.powerWp=parseDecimal(resolveRowValue(row,headers,mapping,'powerWp'),{field:'powerWp',decimalFormat});}catch{errors.push('INVALID_POWER_WP');}
      if(!data.powerWp||data.powerWp<=0)errors.push('POWER_WP_REQUIRED');
    }
  }else{
    data.kitId=text(resolveRowValue(row,headers,mapping,'kitId'))||null;data.kitSku=text(resolveRowValue(row,headers,mapping,'kitSku'))||data.supplierSku;data.kitName=text(resolveRowValue(row,headers,mapping,'kitName'))||null;
    if(!data.kitId)errors.push('KIT_ID_REQUIRED');
  }
  return {data,errors:unique(errors),warnings:unique(warnings)};
}

function normalizeRows(parsed,options={}){
  const seen=new Set(),items=[];
  for(let index=0;index<parsed.records.length;index++){
    const row=parsed.records[index],normalized=normalizeRow(row,parsed.headers,options);const key=`${normalized.data.entityType}:${normalized.data.supplierSku||''}`;
    if(seen.has(key))normalized.errors.push('DUPLICATE_SKU');else seen.add(key);
    const status=normalized.errors.length?'INVALID': 'REVIEW_REQUIRED';
    items.push({rowNumber:index+2,rawData:row,normalizedData:normalized.data,status,errors:unique(normalized.errors),warnings:normalized.warnings,externalSku:normalized.data.supplierSku});
  }
  return items;
}

module.exports={STOCK_STATUSES,ENTITY_TYPES,PRODUCT_CATEGORIES,DEFAULT_IMPORT_CONFIG,hashSource,decodeCsv,parseCsv,parseDecimal,parseInteger,parseDate,normalizeHeader,normalizeRows,normalizeRow,normalizeStock};
