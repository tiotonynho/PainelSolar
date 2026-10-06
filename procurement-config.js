const DEFAULT_PROCUREMENT_CONFIG=Object.freeze({
  // Pesos iniciais de aquisição; não representam política comercial definitiva.
  weights:Object.freeze({
    price:0.20,
    freight:0.25,
    leadTime:0.15,
    stock:0.15,
    reliability:0.10,
    technical:0.15
  }),
  supplierScoreWeights:Object.freeze({
    deliveryReliability:0.25,
    stockAccuracy:0.20,
    priceConsistency:0.15,
    supportQuality:0.15,
    warrantyHandling:0.10,
    orderSuccessRate:0.15
  }),
  closeScoreTolerance:2,
  stockScores:Object.freeze({AVAILABLE:100,LOW_STOCK:70}),
  autoRecommendation:Object.freeze({
    requireLandedCost:true,
    requireKnownStock:true,
    requireKnownSupplierLeadTime:true
  })
});

const isFiniteNumber=value=>typeof value==='number'&&Number.isFinite(value);

function normalizedWeights(input,defaults,label){
  const values={...defaults,...(input||{})};
  const errors=[];
  const total=Object.values(values).reduce((sum,item)=>sum+(isFiniteNumber(item)&&item>=0?item:0),0);
  if(!Object.values(values).every(item=>isFiniteNumber(item)&&item>=0)||total<=0)errors.push(`${label} deve possuir números não negativos e soma maior que zero.`);
  return {values,total,errors};
}

function resolveProcurementConfig(overrides={}){
  const weights=normalizedWeights(overrides.weights,DEFAULT_PROCUREMENT_CONFIG.weights,'weights');
  const supplierScoreWeights=normalizedWeights(overrides.supplierScoreWeights,DEFAULT_PROCUREMENT_CONFIG.supplierScoreWeights,'supplierScoreWeights');
  const stockScores={...DEFAULT_PROCUREMENT_CONFIG.stockScores,...(overrides.stockScores||{})};
  const autoRecommendation={...DEFAULT_PROCUREMENT_CONFIG.autoRecommendation,...(overrides.autoRecommendation||{})};
  const errors=[...weights.errors,...supplierScoreWeights.errors];
  if(!isFiniteNumber(overrides.closeScoreTolerance===undefined?DEFAULT_PROCUREMENT_CONFIG.closeScoreTolerance:overrides.closeScoreTolerance)||Number(overrides.closeScoreTolerance??DEFAULT_PROCUREMENT_CONFIG.closeScoreTolerance)<0)errors.push('closeScoreTolerance deve ser não negativo.');
  if(!Object.values(stockScores).every(item=>isFiniteNumber(item)&&item>=0&&item<=100))errors.push('stockScores deve possuir valores entre 0 e 100.');
  if(!Object.values(autoRecommendation).every(item=>typeof item==='boolean'))errors.push('autoRecommendation deve possuir flags booleanas.');
  if(errors.length)throw Object.assign(new Error(errors.join(' ')),{code:'PROCUREMENT_CONFIG',errors});
  return Object.freeze({
    weights:Object.freeze(Object.fromEntries(Object.entries(weights.values).map(([key,item])=>[key,item/weights.total]))),
    supplierScoreWeights:Object.freeze(Object.fromEntries(Object.entries(supplierScoreWeights.values).map(([key,item])=>[key,item/supplierScoreWeights.total]))),
    closeScoreTolerance:overrides.closeScoreTolerance===undefined?DEFAULT_PROCUREMENT_CONFIG.closeScoreTolerance:overrides.closeScoreTolerance,
    stockScores:Object.freeze({...stockScores}),
    autoRecommendation:Object.freeze({...autoRecommendation})
  });
}

module.exports={DEFAULT_PROCUREMENT_CONFIG,resolveProcurementConfig};
