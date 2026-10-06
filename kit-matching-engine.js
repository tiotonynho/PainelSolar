const KitCore=require('./kit-core');
const SolarSizingEngine=require('./solar-sizing-engine');
const {DEFAULT_MATCHING_CONFIG,resolveMatchingConfig}=require('./matching-config');

const MATCH_CLASSIFICATIONS=Object.freeze(['EXACT','GOOD','ACCEPTABLE']);
const NOOP_LOGGER=Object.freeze({info(){},warn(){}});

class MatchingValidationError extends Error{
  constructor(errors){
    super(errors.join(' '));
    this.name='MatchingValidationError';
    this.code='MATCHING_VALIDATION';
    this.errors=errors;
  }
}

const isFiniteNumber=value=>typeof value==='number'&&Number.isFinite(value);
const round=(value,places=4)=>Number(value.toFixed(places));

function normalizeVoltage(value){
  if(value===undefined||value===null||value==='')return null;
  const values=Array.isArray(value)?value:
    typeof value==='number'?[value]:
    typeof value==='string'?value.match(/\d+(?:[.,]\d+)?/g)||[]:[];
  const normalized=values.map(item=>typeof item==='string'?Number(item.replace(',','.')):item)
    .filter(item=>isFiniteNumber(item)&&item>0)
    .map(item=>round(item,3));
  return normalized.length?[...new Set(normalized)]:null;
}

function voltageMatches(requirementVoltage,kitVoltage){
  const required=normalizeVoltage(requirementVoltage);
  const available=normalizeVoltage(kitVoltage);
  return required!==null&&available!==null&&required.some(value=>available.includes(value));
}

function validateRequirements(input={}){
  const errors=[];
  if(!input||typeof input!=='object'||Array.isArray(input))return {valid:false,errors:['Requisitos solares devem ser um objeto.']};
  if(!isFiniteNumber(input.requiredDcPowerWp)||input.requiredDcPowerWp<=0)errors.push('requiredDcPowerWp deve ser maior que zero.');
  for(const [key,label] of [['installedDcPowerWp','installedDcPowerWp'],['modulePowerWp','modulePowerWp']]){
    if(input[key]!==undefined&&(!isFiniteNumber(input[key])||input[key]<=0))errors.push(`${label} deve ser maior que zero quando informado.`);
  }
  if(input.moduleCount!==undefined&&(!Number.isInteger(input.moduleCount)||input.moduleCount<=0))errors.push('moduleCount deve ser um inteiro maior que zero quando informado.');
  try{SolarSizingEngine.normalizeConnectionType(input.connectionType);}catch(error){errors.push(...(error.errors||['connectionType inválido.']));}
  if(input.voltage!==undefined&&input.voltage!==null&&normalizeVoltage(input.voltage)===null)errors.push('voltage deve possuir um valor positivo quando informado.');
  return {valid:errors.length===0,errors:[...new Set(errors)]};
}

function normalizeRequirements(input={}){
  const validation=validateRequirements(input);
  if(!validation.valid)throw new MatchingValidationError(validation.errors);
  return {
    requiredDcPowerWp:input.requiredDcPowerWp,
    installedDcPowerWp:input.installedDcPowerWp===undefined?null:input.installedDcPowerWp,
    modulePowerWp:input.modulePowerWp===undefined?null:input.modulePowerWp,
    moduleCount:input.moduleCount===undefined?null:input.moduleCount,
    connectionType:SolarSizingEngine.normalizeConnectionType(input.connectionType),
    voltage:input.voltage===undefined?null:input.voltage
  };
}

function productsForItems(items){
  return items.map(item=>item?.product).filter(Boolean);
}

function validateKitForMatching(kit){
  const items=Array.isArray(kit?.items)?kit.items:[];
  const validation=KitCore.validateKit(kit,items,productsForItems(items));
  const errors=[...validation.errors];
  if(validation.calculatedModulePowerWp<=0)errors.push('Kit não possui potência DC de módulos calculável.');
  return {...validation,valid:errors.length===0,errors};
}

function reject(kit,reasons,details={}){
  return {
    kitId:kit?.id??null,
    kitName:kit?.name||null,
    reasons:[...new Set(reasons)],
    details
  };
}

function classifyMatch(deviationRatio,config){
  const absoluteDeviation=Math.abs(deviationRatio);
  if(absoluteDeviation<=config.exactMatchTolerance)return 'EXACT';
  if(absoluteDeviation<=config.goodMatchTolerance)return 'GOOD';
  return 'ACCEPTABLE';
}

function calculateTechnicalScore({deviationRatio,connectionExact},config){
  const powerProximityScore=Math.max(0,100*(1-Math.abs(deviationRatio)));
  const connectionScore=connectionExact?config.scores.exactConnection:config.scores.flexibleConnection;
  const voltageScore=config.scores.voltageMatch;
  const score=powerProximityScore*config.weights.powerProximity+
    connectionScore*config.weights.connectionCompatibility+
    voltageScore*config.weights.voltageCompatibility;
  return round(score,2);
}

function evaluateKit(requirements,kit,config){
  if(!kit||kit.active!==true)return {match:null,rejection:reject(kit,['KIT_INACTIVE'])};
  const validation=validateKitForMatching(kit);
  if(!validation.valid){
    return {match:null,rejection:reject(kit,['KIT_INVALID'],{errors:validation.errors,warnings:validation.warnings})};
  }
  let kitPhase;
  try{kitPhase=SolarSizingEngine.normalizeConnectionType(kit.phaseType);}catch(error){
    return {match:null,rejection:reject(kit,['KIT_INVALID'],{errors:['Tipo de fase do kit inválido.']})};
  }
  const connectionFlexible=requirements.connectionType==='FLEXIBLE'||kitPhase==='FLEXIBLE';
  const connectionExact=!connectionFlexible&&requirements.connectionType===kitPhase;
  if(!connectionFlexible&&!connectionExact){
    return {match:null,rejection:reject(kit,['CONNECTION_TYPE_MISMATCH'],{required:requirements.connectionType,kit:kitPhase})};
  }
  const requiredVoltages=normalizeVoltage(requirements.voltage);
  const kitVoltages=normalizeVoltage(kit.voltage);
  if(requiredVoltages===null||kitVoltages===null){
    return {match:null,rejection:reject(kit,['VOLTAGE_UNKNOWN'],{required:requirements.voltage,kit:kit.voltage})};
  }
  if(!requiredVoltages.some(value=>kitVoltages.includes(value))){
    return {match:null,rejection:reject(kit,['VOLTAGE_MISMATCH'],{required:requirements.voltage,kit:kit.voltage})};
  }
  const kitPowerWp=validation.calculatedModulePowerWp;
  const powerRatio=kitPowerWp/requirements.requiredDcPowerWp;
  if(powerRatio<config.minPowerRatio)return {match:null,rejection:reject(kit,['POWER_TOO_LOW'],{powerRatio,minPowerRatio:config.minPowerRatio,kitPowerWp})};
  if(powerRatio>config.maxPowerRatio)return {match:null,rejection:reject(kit,['POWER_TOO_HIGH'],{powerRatio,maxPowerRatio:config.maxPowerRatio,kitPowerWp})};
  const powerDeviationWp=kitPowerWp-requirements.requiredDcPowerWp;
  const powerDeviationPercent=powerDeviationWp/requirements.requiredDcPowerWp*100;
  const deviationRatio=powerDeviationWp/requirements.requiredDcPowerWp;
  const reasons=['POWER_WITHIN_TARGET',connectionExact?'CONNECTION_TYPE_MATCH':'CONNECTION_TYPE_FLEXIBLE','VOLTAGE_MATCH'];
  if(validation.powerDiverges)reasons.push('NOMINAL_POWER_DIVERGENCE');
  return {
    match:{
      kitId:kit.id,
      kitName:kit.name||null,
      kitPowerWp,
      phaseType:kitPhase,
      voltage:kit.voltage??null,
      powerDeviationWp,
      powerDeviationPercent:round(powerDeviationPercent,4),
      technicalScore:calculateTechnicalScore({deviationRatio,connectionExact},config),
      classification:classifyMatch(deviationRatio,config),
      reasons,
      validationWarnings:validation.warnings
    },
    rejection:null
  };
}

function compareIds(left,right){
  return String(left).localeCompare(String(right),undefined,{numeric:true});
}

function matchKits(requirementsInput,kits,options={}){
  const logger=options.logger||NOOP_LOGGER;
  let requirements;
  try{requirements=normalizeRequirements(requirementsInput);}catch(error){
    logger.warn?.({event:'INVALID_REQUIREMENTS',errors:error.errors||[error.message]});
    throw error;
  }
  if(!Array.isArray(kits)){
    const error=new MatchingValidationError(['Kits devem ser uma lista.']);
    logger.warn?.({event:'INVALID_REQUIREMENTS',errors:error.errors});
    throw error;
  }
  const config=resolveMatchingConfig(options.config||{});
  logger.info?.({event:'MATCH_STARTED',candidateCount:kits.length});
  const matches=[],rejected=[];
  for(const kit of kits){
    const result=evaluateKit(requirements,kit,config);
    if(result.match)matches.push(result.match);
    else rejected.push(result.rejection);
  }
  matches.sort((left,right)=>right.technicalScore-left.technicalScore||Math.abs(left.powerDeviationWp)-Math.abs(right.powerDeviationWp)||compareIds(left.kitId,right.kitId));
  const result={requirements,matches,rejected,evaluatedCount:kits.length,config};
  logger.info?.({event:'MATCH_COMPLETED',candidateCount:kits.length,matchCount:matches.length,rejectedCount:rejected.length});
  if(!matches.length)logger.warn?.({event:'NO_COMPATIBLE_KITS',candidateCount:kits.length});
  return result;
}

module.exports={
  DEFAULT_MATCHING_CONFIG,MATCH_CLASSIFICATIONS,MatchingValidationError,
  normalizeVoltage,voltageMatches,validateRequirements,normalizeRequirements,
  validateKitForMatching,classifyMatch,calculateTechnicalScore,matchKits
};
