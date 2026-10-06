(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory();
  else root.SolarSizingEngine=factory();
})(typeof window==='undefined'?globalThis:window,()=>{
  const MONTH_COUNT=12;
  const DAYS_PER_MONTH=30.4;
  const DEFAULT_MONTHLY_HSP=Object.freeze([5.18,5.61,5.09,5.19,4.82,4.66,4.98,5.70,5.38,5.33,4.94,5.13]);
  const AVAILABILITY_BY_CONNECTION=Object.freeze({MONOPHASIC:30,BIPHASIC:50,TRIPHASIC:100});
  const aliases=Object.freeze({
    '30':'MONOPHASIC','MONOPHASIC':'MONOPHASIC','MONOFASICO':'MONOPHASIC',
    '50':'BIPHASIC','BIPHASIC':'BIPHASIC','BIFASICO':'BIPHASIC',
    '100':'TRIPHASIC','TRIPHASIC':'TRIPHASIC','TRIFASICO':'TRIPHASIC','TRIFASICO':'TRIPHASIC',
    'FLEXIBLE':'FLEXIBLE'
  });

  class SizingValidationError extends Error{
    constructor(errors){super(errors.join(' '));this.name='SizingValidationError';this.code='SIZING_VALIDATION';this.errors=errors;}
  }

  const isNumber=value=>typeof value==='number'&&Number.isFinite(value);
  const normalized=value=>typeof value==='string'?value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase():value;

  function normalizeConnectionType(value){
    const result=aliases[normalized(value)];
    if(!result)throw new SizingValidationError(['Tipo de ligação inválido.']);
    return result;
  }

  function getAvailabilityConsumption(connectionType,explicitValue){
    const normalizedType=connectionType===undefined?'FLEXIBLE':normalizeConnectionType(connectionType);
    if(explicitValue!==undefined){
      if(!isNumber(explicitValue)||explicitValue<0)throw new SizingValidationError(['Disponibilidade de consumo inválida.']);
      return explicitValue;
    }
    if(AVAILABILITY_BY_CONNECTION[normalizedType]===undefined)throw new SizingValidationError(['Tipo de ligação FLEXIBLE exige disponibilidade explícita.']);
    return AVAILABILITY_BY_CONNECTION[normalizedType];
  }

  function normalizeConsumptions(input){
    const values=input.monthlyConsumptions!==undefined?input.monthlyConsumptions:
      input.monthlyConsumptionKwh!==undefined?[input.monthlyConsumptionKwh]:null;
    if(!Array.isArray(values)||values.length<1||values.length>MONTH_COUNT)throw new SizingValidationError(['Informe entre 1 e 12 consumos mensais.']);
    if(!values.every(value=>isNumber(value)&&value>=0))throw new SizingValidationError(['Consumos mensais devem ser números não negativos.']);
    return values.slice();
  }

  function normalizeHspProfile(value){
    const profile=value===undefined?DEFAULT_MONTHLY_HSP:value;
    if(!Array.isArray(profile)||profile.length!==MONTH_COUNT)throw new SizingValidationError(['O perfil mensal de HSP deve possuir 12 valores.']);
    if(!profile.every(item=>isNumber(item)&&item>0))throw new SizingValidationError(['O perfil mensal de HSP deve possuir valores positivos.']);
    return profile.slice();
  }

  function validateSizingInput(input={}){
    const errors=[];
    try{normalizeConsumptions(input);}catch(error){errors.push(...error.errors||[error.message]);}
    if(input.hsp===undefined||!isNumber(input.hsp)||input.hsp<=0)errors.push('HSP deve ser maior que zero.');
    if(input.performanceRatio===undefined||!isNumber(input.performanceRatio)||input.performanceRatio<=0||input.performanceRatio>1)errors.push('Performance ratio deve estar entre 0 e 1.');
    if(input.modulePowerWp===undefined||!isNumber(input.modulePowerWp)||input.modulePowerWp<=0)errors.push('Potência do módulo deve ser maior que zero.');
    try{getAvailabilityConsumption(input.connectionType,input.availabilityConsumptionKwh);}catch(error){errors.push(...error.errors||[error.message]);}
    try{normalizeHspProfile(input.monthlyHspProfile);}catch(error){errors.push(...error.errors||[error.message]);}
    return {valid:errors.length===0,errors:[...new Set(errors)]};
  }

  function calculateAverageConsumption(monthlyConsumptions){
    if(!Array.isArray(monthlyConsumptions)||monthlyConsumptions.length<1||monthlyConsumptions.length>MONTH_COUNT)throw new SizingValidationError(['Informe entre 1 e 12 consumos mensais.']);
    if(!monthlyConsumptions.every(value=>isNumber(value)&&value>=0))throw new SizingValidationError(['Consumos mensais devem ser números não negativos.']);
    return monthlyConsumptions.reduce((sum,value)=>sum+value,0)/monthlyConsumptions.length;
  }

  function calculateRequiredPower(compensableConsumptionKwh,hsp,performanceRatio){
    if(!isNumber(compensableConsumptionKwh)||compensableConsumptionKwh<0)throw new SizingValidationError(['Consumo compensável inválido.']);
    if(!isNumber(hsp)||hsp<=0)throw new SizingValidationError(['HSP deve ser maior que zero.']);
    if(!isNumber(performanceRatio)||performanceRatio<=0||performanceRatio>1)throw new SizingValidationError(['Performance ratio deve estar entre 0 e 1.']);
    return compensableConsumptionKwh/(hsp*DAYS_PER_MONTH*performanceRatio)*1000;
  }

  function calculateModuleCount(requiredDcPowerWp,modulePowerWp){
    if(!isNumber(requiredDcPowerWp)||requiredDcPowerWp<0)throw new SizingValidationError(['Potência DC necessária inválida.']);
    if(!isNumber(modulePowerWp)||modulePowerWp<=0)throw new SizingValidationError(['Potência do módulo deve ser maior que zero.']);
    return Math.max(1,Math.ceil(requiredDcPowerWp/modulePowerWp));
  }

  function calculateInstalledPower(moduleCount,modulePowerWp){
    if(!Number.isInteger(moduleCount)||moduleCount<0)throw new SizingValidationError(['Quantidade de módulos inválida.']);
    if(!isNumber(modulePowerWp)||modulePowerWp<=0)throw new SizingValidationError(['Potência do módulo deve ser maior que zero.']);
    return moduleCount*modulePowerWp;
  }

  function estimateMonthlyGeneration({monthlyHspProfile,hsp,performanceRatio,installedDcPowerWp}){
    const profile=normalizeHspProfile(monthlyHspProfile);
    if(!isNumber(hsp)||hsp<=0)throw new SizingValidationError(['HSP deve ser maior que zero.']);
    if(!isNumber(performanceRatio)||performanceRatio<=0||performanceRatio>1)throw new SizingValidationError(['Performance ratio deve estar entre 0 e 1.']);
    if(!isNumber(installedDcPowerWp)||installedDcPowerWp<0)throw new SizingValidationError(['Potência DC instalada inválida.']);
    const referenceHsp=profile.reduce((sum,value)=>sum+value,0)/profile.length;
    const installedKwp=installedDcPowerWp/1000;
    return profile.map(monthlyHsp=>monthlyHsp/referenceHsp*hsp*DAYS_PER_MONTH*performanceRatio*installedKwp);
  }

  function estimateAnnualGeneration(monthlyGenerationKwh){
    if(!Array.isArray(monthlyGenerationKwh)||!monthlyGenerationKwh.every(isNumber))throw new SizingValidationError(['Geração mensal inválida.']);
    return monthlyGenerationKwh.reduce((sum,value)=>sum+value,0);
  }

  function calculateSizing(input={}){
    const validation=validateSizingInput(input);
    if(!validation.valid)throw new SizingValidationError(validation.errors);
    const monthlyConsumptions=normalizeConsumptions(input);
    const connectionType=input.connectionType===undefined?'FLEXIBLE':normalizeConnectionType(input.connectionType);
    const availabilityConsumptionKwh=getAvailabilityConsumption(connectionType,input.availabilityConsumptionKwh);
    const hsp=input.hsp;
    const performanceRatio=input.performanceRatio;
    const modulePowerWp=input.modulePowerWp;
    const monthlyHspProfile=normalizeHspProfile(input.monthlyHspProfile);
    const averageConsumptionKwh=calculateAverageConsumption(monthlyConsumptions);
    const compensableConsumptionKwh=Math.max(averageConsumptionKwh-availabilityConsumptionKwh,0);
    const requiredDcPowerWp=calculateRequiredPower(compensableConsumptionKwh,hsp,performanceRatio);
    const moduleCount=calculateModuleCount(requiredDcPowerWp,modulePowerWp);
    const installedDcPowerWp=calculateInstalledPower(moduleCount,modulePowerWp);
    const monthlyGenerationKwh=estimateMonthlyGeneration({monthlyHspProfile,hsp,performanceRatio,installedDcPowerWp});
    const estimatedAnnualGenerationKwh=estimateAnnualGeneration(monthlyGenerationKwh);
    return {
      monthlyConsumptions,
      averageConsumptionKwh,
      connectionType,
      availabilityConsumptionKwh,
      compensableConsumptionKwh,
      hsp,
      performanceRatio,
      monthlyHspProfile,
      referenceHsp:monthlyHspProfile.reduce((sum,value)=>sum+value,0)/monthlyHspProfile.length,
      requiredDcPowerWp,
      modulePowerWp,
      moduleCount,
      installedDcPowerWp,
      monthlyGenerationKwh,
      estimatedMonthlyGenerationKwh:estimatedAnnualGenerationKwh/monthlyGenerationKwh.length,
      estimatedAnnualGenerationKwh
    };
  }

  function emptySizingResult(input={}){
    const monthlyConsumptions=Array.isArray(input.monthlyConsumptions)?input.monthlyConsumptions.slice():[];
    const profile=Array.isArray(input.monthlyHspProfile)&&input.monthlyHspProfile.length===MONTH_COUNT?input.monthlyHspProfile.slice():DEFAULT_MONTHLY_HSP.slice();
    return {
      monthlyConsumptions,
      averageConsumptionKwh:0,
      connectionType:null,
      availabilityConsumptionKwh:0,
      compensableConsumptionKwh:0,
      hsp:isNumber(input.hsp)?input.hsp:0,
      performanceRatio:isNumber(input.performanceRatio)?input.performanceRatio:0,
      monthlyHspProfile:profile,
      referenceHsp:profile.reduce((sum,value)=>sum+(isNumber(value)?value:0),0)/profile.length,
      requiredDcPowerWp:0,
      modulePowerWp:isNumber(input.modulePowerWp)?input.modulePowerWp:0,
      moduleCount:0,
      installedDcPowerWp:0,
      monthlyGenerationKwh:profile.map(()=>0),
      estimatedMonthlyGenerationKwh:0,
      estimatedAnnualGenerationKwh:0
    };
  }

  return {
    MONTH_COUNT,DAYS_PER_MONTH,DEFAULT_MONTHLY_HSP,AVAILABILITY_BY_CONNECTION,
    SizingValidationError,normalizeConnectionType,getAvailabilityConsumption,validateSizingInput,
    calculateAverageConsumption,calculateRequiredPower,calculateModuleCount,calculateInstalledPower,
    estimateMonthlyGeneration,estimateAnnualGeneration,calculateSizing,emptySizingResult
  };
});
