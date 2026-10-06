const DEFAULT_MATCHING_CONFIG=Object.freeze({
  // Configuração inicial conservadora; não representa norma de engenharia.
  minPowerRatio:0.9,
  maxPowerRatio:1.2,
  exactMatchTolerance:0.05,
  goodMatchTolerance:0.10,
  weights:Object.freeze({
    powerProximity:0.7,
    connectionCompatibility:0.2,
    voltageCompatibility:0.1
  }),
  scores:Object.freeze({
    exactConnection:100,
    flexibleConnection:95,
    voltageMatch:100
  })
});

const isFiniteNumber=value=>typeof value==='number'&&Number.isFinite(value);

function resolveMatchingConfig(overrides={}){
  const value={...DEFAULT_MATCHING_CONFIG,...overrides};
  const weights={...DEFAULT_MATCHING_CONFIG.weights,...(overrides.weights||{})};
  const scores={...DEFAULT_MATCHING_CONFIG.scores,...(overrides.scores||{})};
  const errors=[];
  if(!isFiniteNumber(value.minPowerRatio)||value.minPowerRatio<=0)errors.push('minPowerRatio deve ser maior que zero.');
  if(!isFiniteNumber(value.maxPowerRatio)||value.maxPowerRatio<value.minPowerRatio)errors.push('maxPowerRatio deve ser maior ou igual a minPowerRatio.');
  if(!isFiniteNumber(value.exactMatchTolerance)||value.exactMatchTolerance<0)errors.push('exactMatchTolerance deve ser não negativo.');
  if(!isFiniteNumber(value.goodMatchTolerance)||value.goodMatchTolerance<value.exactMatchTolerance)errors.push('goodMatchTolerance deve ser maior ou igual a exactMatchTolerance.');
  const weightTotal=Object.values(weights).reduce((sum,item)=>sum+(isFiniteNumber(item)&&item>=0?item:0),0);
  if(!Object.values(weights).every(item=>isFiniteNumber(item)&&item>=0)||weightTotal<=0)errors.push('weights deve possuir números não negativos e soma maior que zero.');
  if(!Object.values(scores).every(item=>isFiniteNumber(item)&&item>=0&&item<=100))errors.push('scores deve possuir valores entre 0 e 100.');
  if(errors.length)throw Object.assign(new Error(errors.join(' ')),{code:'MATCHING_CONFIG',errors});
  return Object.freeze({
    minPowerRatio:value.minPowerRatio,
    maxPowerRatio:value.maxPowerRatio,
    exactMatchTolerance:value.exactMatchTolerance,
    goodMatchTolerance:value.goodMatchTolerance,
    weights:Object.freeze(Object.fromEntries(Object.entries(weights).map(([key,item])=>[key,item/weightTotal]))),
    scores:Object.freeze({...scores})
  });
}

module.exports={DEFAULT_MATCHING_CONFIG,resolveMatchingConfig};
