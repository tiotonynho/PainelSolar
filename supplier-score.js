const SUPPLIER_SCORE_METRICS=Object.freeze([
  'deliveryReliability',
  'stockAccuracy',
  'priceConsistency',
  'supportQuality',
  'warrantyHandling',
  'orderSuccessRate'
]);
const SCORE_STATUSES=Object.freeze(['KNOWN','UNKNOWN','UNAVAILABLE']);
const isFiniteNumber=value=>typeof value==='number'&&Number.isFinite(value);
const round=(value,places=2)=>Number(value.toFixed(places));

function normalizeMetric(value){
  if(value===undefined||value===null)return {status:'UNKNOWN',value:null};
  if(isFiniteNumber(value)){
    if(value<0||value>100)return {status:'UNAVAILABLE',value:null};
    return {status:'KNOWN',value};
  }
  if(typeof value==='object'){
    const status=(value.status||'UNKNOWN').toString().toUpperCase();
    if(!SCORE_STATUSES.includes(status))return {status:'UNAVAILABLE',value:null};
    if(status!=='KNOWN')return {status,value:null};
    if(!isFiniteNumber(value.value)||value.value<0||value.value>100)return {status:'UNAVAILABLE',value:null};
    return {status,value:value.value};
  }
  return {status:'UNAVAILABLE',value:null};
}

function calculateSupplierScore(supplier={},options={}){
  const weights=options.weights||{};
  const input=options.metrics||supplier.scoreMetrics||supplier.performanceMetrics||{};
  if(isFiniteNumber(input.score)&&input.score>=0&&input.score<=100){
    return {
      supplierId:supplier.id||null,
      supplierName:supplier.name||null,
      status:'KNOWN',
      score:round(input.score),
      components:{},
      warnings:[]
    };
  }
  const components={};
  const known=[];
  for(const metric of SUPPLIER_SCORE_METRICS){
    const normalized=normalizeMetric(input[metric]);
    components[metric]=normalized;
    if(normalized.status==='KNOWN')known.push(metric);
  }
  const warnings=[];
  let status='UNKNOWN';
  if(known.length){
    status='KNOWN';
    if(known.length<SUPPLIER_SCORE_METRICS.length)warnings.push('SUPPLIER_SCORE_PARTIAL');
  }else if(Object.values(components).some(item=>item.status==='UNAVAILABLE')){
    status='UNAVAILABLE';
  }else warnings.push('SUPPLIER_RELIABILITY_UNKNOWN');
  let score=null;
  if(known.length){
    const total=known.reduce((sum,metric)=>sum+(Number(weights[metric])||0),0);
    if(total>0)score=round(known.reduce((sum,metric)=>sum+components[metric].value*(Number(weights[metric])||0),0)/total);
    else status='UNKNOWN';
  }
  if(score===null&&!warnings.includes('SUPPLIER_RELIABILITY_UNKNOWN'))warnings.push('SUPPLIER_RELIABILITY_UNKNOWN');
  return {supplierId:supplier.id||null,supplierName:supplier.name||null,status,score,components,warnings};
}

module.exports={SUPPLIER_SCORE_METRICS,SCORE_STATUSES,normalizeMetric,calculateSupplierScore};
