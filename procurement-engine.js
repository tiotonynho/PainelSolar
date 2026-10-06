const {resolveProcurementConfig}=require('./procurement-config');
const {calculateSupplierScore}=require('./supplier-score');
const {normalizeFreightQuote,findFreightQuote,normalizePostalCode}=require('./freight-quote');

const STOCK_STATUSES=Object.freeze(['AVAILABLE','LOW_STOCK','OUT_OF_STOCK','UNKNOWN']);
const NOOP_LOGGER=Object.freeze({info(){},warn(){}});
const isFiniteNumber=value=>typeof value==='number'&&Number.isFinite(value);
const round=(value,places=2)=>Number(value.toFixed(places));

class ProcurementValidationError extends Error{
  constructor(errors){
    super(errors.join(' '));
    this.name='ProcurementValidationError';
    this.code='PROCUREMENT_VALIDATION';
    this.errors=errors;
  }
}

function asMap(values){
  if(values instanceof Map)return values;
  const list=Array.isArray(values)?values:Object.values(values||{});
  return new Map(list.filter(item=>item&&item.id!==undefined).map(item=>[String(item.id),item]));
}

function scoreMapValue(values,id){
  if(values instanceof Map)return values.get(id);
  return values?.[id];
}

function normalizeProcurementInput(input={}){
  const errors=[];
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ProcurementValidationError(['Procurement input deve ser um objeto.']);
  let compatibleKits=input.compatibleKits??input.matches;
  if(compatibleKits&&!Array.isArray(compatibleKits)&&Array.isArray(compatibleKits.matches))compatibleKits=compatibleKits.matches;
  if(!Array.isArray(compatibleKits))errors.push('compatibleKits deve ser uma lista de matches técnicos.');
  if(!Array.isArray(input.kits)&&!(input.kits instanceof Map)&&(!input.kits||typeof input.kits!=='object'))errors.push('kits deve ser uma lista ou mapa de kits hidratados.');
  let destinationPostalCode=null;
  try{destinationPostalCode=normalizePostalCode(input.destinationPostalCode);}catch(error){errors.push(error.message);}
  const now=input.now===undefined?Date.now():Number(input.now);
  if(!Number.isInteger(now)||now<0)errors.push('now deve ser timestamp válido.');
  if(errors.length)throw new ProcurementValidationError(errors);
  return {compatibleKits,kits:input.kits,destinationPostalCode,freightQuotes:Array.isArray(input.freightQuotes)?input.freightQuotes:[],supplierScores:input.supplierScores||{},now};
}

function reject(match,source,reasons,details={}){
  return {
    kitId:match?.kitId??source?.kitId??null,
    supplierId:source?.supplierId??null,
    supplierKitId:source?.id??source?.supplierKitId??null,
    supplierKitOfferId:source?.offerId??source?.id??null,
    reasons:[...new Set(reasons)],
    details
  };
}

function lowerIsBetterScore(value,values){
  if(!isFiniteNumber(value)||!values.length)return null;
  const minimum=Math.min(...values),maximum=Math.max(...values);
  if(maximum===minimum)return 100;
  return round((maximum-value)/(maximum-minimum)*100,2);
}

function scoreValues(candidates,selector){
  return candidates.map(selector).filter(isFiniteNumber);
}

function supplierFor(supplierKit,suppliers){
  return supplierKit?.supplier||asMap(suppliers).get(String(supplierKit?.supplierId));
}

function evaluateOffer(match,kit,supplierKit,supplier,offer,context){
  const source={id:supplierKit?.id,supplierId:supplierKit?.supplierId,offerId:offer?.id};
  if(!supplier||supplier.active!==true)return {candidate:null,rejection:reject(match,source,['SUPPLIER_INACTIVE'])};
  if(supplierKit?.active!==true)return {candidate:null,rejection:reject(match,source,['SUPPLIER_KIT_INACTIVE'])};
  if(!offer||!isFiniteNumber(offer.price)||offer.price<=0)return {candidate:null,rejection:reject(match,source,['INVALID_PRICE'],{price:offer?.price??null})};
  if(offer.validUntil!==undefined&&offer.validUntil!==null){
    if(!isFiniteNumber(offer.validUntil))return {candidate:null,rejection:reject(match,source,['MISSING_REQUIRED_DATA'],{field:'validUntil'})};
    if(offer.validUntil<=context.now)return {candidate:null,rejection:reject(match,source,['OFFER_EXPIRED'],{validUntil:offer.validUntil})};
  }
  const stockStatus=(offer.stockStatus||'UNKNOWN').toString().toUpperCase();
  if(!STOCK_STATUSES.includes(stockStatus))return {candidate:null,rejection:reject(match,source,['MISSING_REQUIRED_DATA'],{field:'stockStatus'})};
  if(stockStatus==='OUT_OF_STOCK')return {candidate:null,rejection:reject(match,source,['OUT_OF_STOCK'])};
  const supplierLeadTimeDays=offer.leadTimeDays===null||offer.leadTimeDays===undefined?null:offer.leadTimeDays;
  if(supplierLeadTimeDays!==null&&(!Number.isInteger(supplierLeadTimeDays)||supplierLeadTimeDays<0))return {candidate:null,rejection:reject(match,source,['MISSING_REQUIRED_DATA'],{field:'leadTimeDays'})};
  const freight=findFreightQuote(context.freightQuotes,{supplierId:supplier.id,supplierKitId:supplierKit.id,postalCode:context.destinationPostalCode},context.now);
  const warnings=[];
  if(freight.reason)warnings.push(freight.reason);
  const quote=freight.quote;
  const freightStatus=quote?.status||'UNKNOWN';
  const freightCost=freightStatus==='KNOWN'?quote.cost:null;
  const freightEstimatedDays=freightStatus==='KNOWN'?quote.estimatedDays:null;
  if(freightStatus==='UNKNOWN')warnings.push('FREIGHT_UNKNOWN');
  if(freightStatus==='UNAVAILABLE')warnings.push('FREIGHT_UNAVAILABLE');
  if(stockStatus==='UNKNOWN')warnings.push('STOCK_UNKNOWN');
  if(stockStatus==='LOW_STOCK')warnings.push('LOW_STOCK_REVIEW');
  if(supplierLeadTimeDays===null)warnings.push('LEAD_TIME_UNKNOWN');
  const supplierScore=calculateSupplierScore(supplier,{metrics:scoreMapValue(context.supplierScores,supplier.id),weights:context.config.supplierScoreWeights});
  warnings.push(...supplierScore.warnings);
  const landedCost=freightStatus==='KNOWN'?offer.price+freightCost:null;
  const estimatedDeliveryDays=supplierLeadTimeDays!==null&&freightEstimatedDays!==null?supplierLeadTimeDays+freightEstimatedDays:null;
  const reasons=['TECHNICAL_MATCH'];
  if(landedCost!==null)reasons.push('LANDED_COST_KNOWN');
  if(stockStatus==='AVAILABLE')reasons.push('STOCK_CONFIRMED');
  if(stockStatus==='LOW_STOCK')reasons.push('LOW_STOCK');
  if(supplierScore.score!==null)reasons.push('SUPPLIER_SCORE_KNOWN');
  const candidate={
    kitId:kit.id,
    kitName:kit.name||null,
    supplierId:supplier.id,
    supplierName:supplier.name||supplierKit.supplierName||null,
    supplierKitId:supplierKit.id,
    supplierKitOfferId:offer.id,
    technicalScore:match.technicalScore,
    classification:match.classification||null,
    equipmentPrice:offer.price,
    currency:offer.currency||'BRL',
    freightCost,
    freightStatus,
    freightEstimatedDays,
    landedCost,
    stockStatus,
    stockQuantity:offer.stockQuantity===undefined?null:offer.stockQuantity,
    leadTimeDays:supplierLeadTimeDays,
    supplierLeadTimeDays,
    estimatedDeliveryDays,
    supplierScore:supplierScore.score,
    supplierReliability:supplierScore.score,
    supplierScoreStatus:supplierScore.status,
    supplierActive:supplier.active===true,
    kitActive:kit.active===true,
    offerValid:true,
    offerValidUntil:offer.validUntil??null,
    technicalMatchValid:true,
    procurementScore:null,
    scoreComponents:null,
    reasons,
    warnings:[...new Set(warnings)],
    requiresReview:false,
    autoEligible:false
  };
  return {candidate,rejection:null};
}

function compareCandidates(left,right){
  return right.procurementScore-left.procurementScore||
    (left.landedCost===null)-(right.landedCost===null)||
    (left.landedCost===null||right.landedCost===null?0:left.landedCost-right.landedCost)||
    (left.leadTimeDays===null)-(right.leadTimeDays===null)||
    (left.leadTimeDays===null||right.leadTimeDays===null?0:left.leadTimeDays-right.leadTimeDays)||
    String(left.supplierId).localeCompare(String(right.supplierId),undefined,{numeric:true})||
    String(left.supplierKitOfferId).localeCompare(String(right.supplierKitOfferId),undefined,{numeric:true});
}

function applyScores(candidates,config){
  const priceValues=scoreValues(candidates,item=>item.equipmentPrice);
  const freightValues=scoreValues(candidates,item=>item.freightStatus==='KNOWN'?item.freightCost:null);
  const leadValues=scoreValues(candidates,item=>item.leadTimeDays);
  for(const candidate of candidates){
    const scoreComponents={
      price:lowerIsBetterScore(candidate.equipmentPrice,priceValues),
      freight:lowerIsBetterScore(candidate.freightStatus==='KNOWN'?candidate.freightCost:null,freightValues),
      leadTime:lowerIsBetterScore(candidate.leadTimeDays,leadValues),
      stock:config.stockScores[candidate.stockStatus]??null,
      reliability:candidate.supplierScore,
      technical:isFiniteNumber(candidate.technicalScore)?candidate.technicalScore:null
    };
    let weighted=0,totalWeight=0;
    for(const [key,score] of Object.entries(scoreComponents)){
      if(score===null||score===undefined)continue;
      const weight=config.weights[key]||0;
      weighted+=score*weight;totalWeight+=weight;
    }
    candidate.scoreComponents=scoreComponents;
    candidate.procurementScore=totalWeight?round(weighted/totalWeight,2):null;
    const auto=config.autoRecommendation;
    candidate.autoEligible=(
      (!auto.requireLandedCost||candidate.landedCost!==null)&&
      (!auto.requireKnownStock||candidate.stockStatus!=='UNKNOWN')&&
      (!auto.requireKnownSupplierLeadTime||candidate.supplierLeadTimeDays!==null)
    );
    candidate.requiresReview=!candidate.autoEligible||candidate.warnings.length>0;
  }
  const landedValues=scoreValues(candidates,item=>item.landedCost);
  const minimumLanded=landedValues.length?Math.min(...landedValues):null;
  const leadTimeValues=scoreValues(candidates,item=>item.leadTimeDays);
  const minimumLead=leadTimeValues.length?Math.min(...leadTimeValues):null;
  for(const candidate of candidates){
    if(candidate.landedCost!==null&&candidate.landedCost===minimumLanded)candidate.reasons.push('BEST_LANDED_COST');
    if(candidate.leadTimeDays!==null&&candidate.leadTimeDays===minimumLead)candidate.reasons.push('SHORT_LEAD_TIME');
  }
  return candidates.sort(compareCandidates);
}

function procurementInput(input,options){
  if(Array.isArray(input))return normalizeProcurementInput({...options,compatibleKits:input});
  return normalizeProcurementInput(input);
}

function procure(input,options={}){
  const logger=options.logger||NOOP_LOGGER;
  let normalized;
  try{normalized=procurementInput(input,options);}catch(error){
    logger.warn?.({event:'PROCUREMENT_INVALID_INPUT',errors:error.errors||[error.message]});
    throw error;
  }
  const config=resolveProcurementConfig(options.config||input.config||{});
  const kitMap=asMap(normalized.kits);
  const supplierMap=asMap(input.suppliers);
  const freightQuotes=[];
  const warnings=[];
  for(const quoteInput of normalized.freightQuotes){
    try{freightQuotes.push(normalizeFreightQuote(quoteInput));}
    catch(error){warnings.push('INVALID_FREIGHT_QUOTE');}
  }
  const context={...normalized,config,supplierScores:normalized.supplierScores,freightQuotes,suppliers:input.suppliers};
  logger.info?.({event:'PROCUREMENT_STARTED',technicalKitCount:normalized.compatibleKits.length});
  const candidates=[],rejected=[];
  for(const match of normalized.compatibleKits){
    const kit=kitMap.get(String(match?.kitId));
    if(!kit){
      const item=reject(match,null,['KIT_NOT_FOUND']);rejected.push(item);logger.warn?.({event:'OFFER_REJECTED',reasons:item.reasons});continue;
    }
    if(!isFiniteNumber(match.technicalScore)){
      const item=reject(match,null,['MISSING_REQUIRED_DATA'],{field:'technicalScore'});rejected.push(item);logger.warn?.({event:'OFFER_REJECTED',reasons:item.reasons});continue;
    }
    const supplierKits=Array.isArray(kit.supplierKits)?kit.supplierKits:[];
    if(!supplierKits.length){
      const item=reject(match,null,['NO_VALID_OFFER'],{field:'supplierKits'});rejected.push(item);logger.warn?.({event:'OFFER_REJECTED',reasons:item.reasons});continue;
    }
    for(const supplierKit of supplierKits){
      const supplier=supplierFor(supplierKit,supplierMap);
      const offers=Array.isArray(supplierKit.offers)?supplierKit.offers:[];
      if(!offers.length){
        const item=reject(match,supplierKit,['NO_VALID_OFFER'],{field:'offers'});rejected.push(item);logger.warn?.({event:'OFFER_REJECTED',reasons:item.reasons});continue;
      }
      for(const offer of offers){
        const result=evaluateOffer(match,kit,supplierKit,supplier,offer,context);
        if(result.candidate)candidates.push(result.candidate);
        else{rejected.push(result.rejection);logger.warn?.({event:'OFFER_REJECTED',reasons:result.rejection.reasons,supplierKitOfferId:offer?.id??null});}
      }
    }
  }
  applyScores(candidates,config);
  const bestOption=candidates.find(candidate=>candidate.autoEligible)||null;
  const alternatives=candidates.filter(candidate=>candidate!==bestOption);
  const allWarnings=[...warnings,...candidates.flatMap(candidate=>candidate.warnings)];
  const autoCandidates=candidates.filter(candidate=>candidate.autoEligible);
  const offersTooClose=autoCandidates.length>1&&Math.abs(autoCandidates[0].procurementScore-autoCandidates[1].procurementScore)<=config.closeScoreTolerance;
  if(offersTooClose){
    autoCandidates[0].warnings.push('OFFERS_TOO_CLOSE');
    autoCandidates[1].warnings.push('OFFERS_TOO_CLOSE');
    allWarnings.push('OFFERS_TOO_CLOSE');
  }
  if(!candidates.length)allWarnings.push('NO_VALID_OFFERS');
  if(!bestOption)allWarnings.push('NO_AUTO_RECOMMENDATION');
  const requiresReview=!bestOption||bestOption.requiresReview||offersTooClose;
  if(requiresReview)allWarnings.push('REVIEW_REQUIRED');
  const result={bestOption,alternatives,rejected,requiresReview,warnings:[...new Set(allWarnings)],evaluatedTechnicalKits:normalized.compatibleKits.length,evaluatedOffers:candidates.length,config};
  logger.info?.({event:'PROCUREMENT_COMPLETED',candidateCount:candidates.length,rejectedCount:rejected.length,requiresReview});
  if(!candidates.length)logger.warn?.({event:'NO_VALID_OFFERS'});
  if(requiresReview)logger.warn?.({event:'REVIEW_REQUIRED'});
  return result;
}

module.exports={
  ProcurementValidationError,STOCK_STATUSES,
  normalizeProcurementInput,lowerIsBetterScore,applyScores,procure,
  runProcurement:procure,evaluateProcurement:procure
};
