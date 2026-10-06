'use strict';

const isFiniteNumber=value=>typeof value==='number'&&Number.isFinite(value);

const PRICING_SOURCES=Object.freeze({MANUAL:'MANUAL',PROCUREMENT:'PROCUREMENT',LEGACY:'LEGACY'});
const SELECTION_MODES=Object.freeze({AUTO:'AUTO',MANUAL:'MANUAL'});
const PROCUREMENT_BLOCKING_REASONS=Object.freeze({
  NO_BEST_OPTION:'NO_BEST_OPTION',
  PRICE_UNKNOWN:'PRICE_UNKNOWN',
  INVALID_PRICE:'INVALID_PRICE',
  FREIGHT_UNKNOWN:'FREIGHT_UNKNOWN',
  STOCK_UNKNOWN:'STOCK_UNKNOWN',
  LOW_STOCK:'LOW_STOCK',
  OUT_OF_STOCK:'OUT_OF_STOCK',
  OFFER_EXPIRED:'OFFER_EXPIRED',
  SUPPLIER_INACTIVE:'SUPPLIER_INACTIVE',
  KIT_INACTIVE:'KIT_INACTIVE',
  TECHNICAL_MATCH_INVALID:'TECHNICAL_MATCH_INVALID',
  PROCUREMENT_REVIEW_REQUIRED:'PROCUREMENT_REVIEW_REQUIRED',
  OFFER_INVALID:'OFFER_INVALID',
  SUPPLIER_STATUS_UNKNOWN:'SUPPLIER_STATUS_UNKNOWN',
  KIT_STATUS_UNKNOWN:'KIT_STATUS_UNKNOWN'
});

class ProcurementPricingValidationError extends Error{
  constructor(message,details=[]){super(message);this.name='ProcurementPricingValidationError';this.code='PROCUREMENT_PRICING_VALIDATION';this.details=details;}
}

const unique=list=>[...new Set((list||[]).filter(Boolean))];
const text=value=>typeof value==='string'?value.trim():'';
const sameId=(left,right)=>left!==undefined&&left!==null&&right!==undefined&&right!==null&&String(left)===String(right);

function normalizeProcurementResult(result={}){
  if(!result||typeof result!=='object'||Array.isArray(result))throw new ProcurementPricingValidationError('ProcurementResult deve ser um objeto.');
  return {
    ...result,
    bestOption:result.bestOption||null,
    alternatives:Array.isArray(result.alternatives)?result.alternatives:[],
    rejected:Array.isArray(result.rejected)?result.rejected:[],
    warnings:Array.isArray(result.warnings)?result.warnings:[],
    requiresReview:result.requiresReview===true
  };
}

function offerExpired(candidate,now){
  const validUntil=candidate?.offerValidUntil??candidate?.validUntil;
  if(validUntil===undefined||validUntil===null||validUntil==='')return false;
  const timestamp=typeof validUntil==='number'?validUntil:Date.parse(validUntil);
  return Number.isFinite(timestamp)&&timestamp<=now;
}

function candidateDecision(candidate,result,{freightRequired=true,now=Date.now(),includeGlobalReview=true}={}){
  const blockingReasons=[];
  const warnings=[];
  if(!candidate){
    blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.NO_BEST_OPTION);
    const rejectedReasons=(result?.rejected||[]).flatMap(item=>Array.isArray(item?.reasons)?item.reasons:[]);
    const known=Object.values(PROCUREMENT_BLOCKING_REASONS);
    blockingReasons.push(...rejectedReasons.filter(reason=>known.includes(reason)));
    return {canAutoPrice:false,requiresReview:true,blockingReasons:unique(blockingReasons),warnings};
  }
  if(includeGlobalReview&&result?.requiresReview===true)blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.PROCUREMENT_REVIEW_REQUIRED);
  if(candidate.requiresReview===true||candidate.autoEligible===false)blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.PROCUREMENT_REVIEW_REQUIRED);
  if(candidate.offerValid===false)blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.OFFER_INVALID);
  if(offerExpired(candidate,now))blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.OFFER_EXPIRED);
  if(candidate.supplierActive===false||candidate.supplier?.active===false)blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.SUPPLIER_INACTIVE);
  else if(candidate.supplierActive===undefined&&candidate.supplier?.active===undefined)blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.SUPPLIER_STATUS_UNKNOWN);
  if(candidate.kitActive===false||candidate.kit?.active===false)blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.KIT_INACTIVE);
  else if(candidate.kitActive===undefined&&candidate.kit?.active===undefined)blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.KIT_STATUS_UNKNOWN);
  const technicalValid=candidate.technicalMatchValid===true||candidate.reasons?.includes?.('TECHNICAL_MATCH');
  if(candidate.technicalMatchValid===false||!technicalValid)blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.TECHNICAL_MATCH_INVALID);
  if(candidate.equipmentPrice===undefined||candidate.equipmentPrice===null)blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.PRICE_UNKNOWN);
  else if(!isFiniteNumber(candidate.equipmentPrice)||candidate.equipmentPrice<=0)blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.INVALID_PRICE);
  const stockStatus=String(candidate.stockStatus||'UNKNOWN').toUpperCase();
  if(stockStatus==='UNKNOWN')blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.STOCK_UNKNOWN);
  else if(stockStatus==='LOW_STOCK')blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.LOW_STOCK);
  else if(stockStatus==='OUT_OF_STOCK')blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.OUT_OF_STOCK);
  else if(stockStatus!=='AVAILABLE')blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.STOCK_UNKNOWN);
  const freightStatus=String(candidate.freightStatus||(candidate.freightCost!==undefined&&candidate.freightCost!==null?'KNOWN':'UNKNOWN')).toUpperCase();
  if(freightRequired&&!(freightStatus==='KNOWN'&&isFiniteNumber(candidate.freightCost)&&candidate.freightCost>=0))blockingReasons.push(PROCUREMENT_BLOCKING_REASONS.FREIGHT_UNKNOWN);
  warnings.push(...(Array.isArray(candidate.warnings)?candidate.warnings:[]));
  if(candidate.supplierScore===null||candidate.supplierScore===undefined)warnings.push('SUPPLIER_RELIABILITY_UNKNOWN');
  return {canAutoPrice:blockingReasons.length===0,requiresReview:blockingReasons.length>0,blockingReasons:unique(blockingReasons),warnings:unique(warnings)};
}

function canAutoPriceFromProcurement(result,options={}){
  const normalized=normalizeProcurementResult(result);
  return candidateDecision(options.candidate??normalized.bestOption,normalized,options);
}

function candidateList(result){
  const normalized=normalizeProcurementResult(result);
  return [normalized.bestOption,...normalized.alternatives].filter(Boolean);
}

function selectProcurementCandidate(result,{selectionMode=SELECTION_MODES.AUTO,selectedOfferId,overrideReason,now=Date.now(),freightRequired=true}={}){
  const normalized=normalizeProcurementResult(result);
  const mode=String(selectionMode||SELECTION_MODES.AUTO).toUpperCase();
  if(!Object.values(SELECTION_MODES).includes(mode))throw new ProcurementPricingValidationError(`selectionMode invÃ¡lido: ${mode}`);
  const candidates=candidateList(normalized);
  let selected=normalized.bestOption;
  if(mode===SELECTION_MODES.MANUAL&&selectedOfferId!==undefined&&selectedOfferId!==null&&selectedOfferId!==''){
    selected=candidates.find(item=>sameId(item.supplierKitOfferId,selectedOfferId)||sameId(item.supplierKitId,selectedOfferId)||sameId(item.id,selectedOfferId))||null;
    if(!selected)throw new ProcurementPricingValidationError('A oferta selecionada nÃ£o pertence ao ProcurementResult.',[String(selectedOfferId)]);
  }
  const isOverride=mode===SELECTION_MODES.MANUAL&&selected&&selected!==normalized.bestOption;
  if(isOverride&&!text(overrideReason))throw new ProcurementPricingValidationError('overrideReason Ã© obrigatÃ³rio para substituir a melhor opÃ§Ã£o.',['overrideReason']);
  const decision=canAutoPriceFromProcurement(normalized,{candidate:selected,freightRequired,now,includeGlobalReview:mode===SELECTION_MODES.AUTO});
  return {result:normalized,selected,selectionMode:mode,override:isOverride,overrideReason:isOverride?text(overrideReason):null,decision};
}

function mapProcurementToPricingInput(selectedOrSelection,{freightRequired=true}={}){
  const selection=selectedOrSelection?.selected?selectedOrSelection:null;
  const selected=selection?selection.selected:selectedOrSelection;
  if(!selected||!isFiniteNumber(selected.equipmentPrice)||selected.equipmentPrice<=0)throw new ProcurementPricingValidationError('A oferta nÃ£o possui equipmentPrice vÃ¡lido.',[PROCUREMENT_BLOCKING_REASONS.INVALID_PRICE]);
  const freightStatus=String(selected.freightStatus||(selected.freightCost!==undefined&&selected.freightCost!==null?'KNOWN':'UNKNOWN')).toUpperCase();
  if(freightRequired&&!(freightStatus==='KNOWN'&&isFiniteNumber(selected.freightCost)&&selected.freightCost>=0))throw new ProcurementPricingValidationError('A oferta nÃ£o possui frete conhecido.',[PROCUREMENT_BLOCKING_REASONS.FREIGHT_UNKNOWN]);
  return {
    mode:'STANDARD',pricingSource:PRICING_SOURCES.PROCUREMENT,
    equipmentCost:selected.equipmentPrice,
    freightCost:freightStatus==='KNOWN'?selected.freightCost:null,
    freightStatus:freightStatus==='KNOWN'?'KNOWN':freightStatus,
    freightRequired:freightRequired===true
  };
}

function buildProcurementSnapshot(selection,{selectedAt=Date.now()}={}){
  const selected=selection?.selected||selection;
  if(!selected)return null;
  return {
    kitId:selected.kitId??null,
    supplierId:selected.supplierId??null,
    supplierKitId:selected.supplierKitId??null,
    supplierKitOfferId:selected.supplierKitOfferId??null,
    equipmentPrice:selected.equipmentPrice??null,
    freightCost:selected.freightCost??null,
    freightStatus:selected.freightStatus??(selected.freightCost===null?'UNKNOWN':'KNOWN'),
    stockStatus:selected.stockStatus??'UNKNOWN',
    leadTimeDays:selected.leadTimeDays??null,
    procurementScore:selected.procurementScore??null,
    technicalScore:selected.technicalScore??null,
    selectedAt:new Date(selectedAt).toISOString(),
    selectionMode:selection?.selectionMode||SELECTION_MODES.AUTO,
    override:selection?.override===true,
    overrideReason:selection?.overrideReason||null,
    requiresReview:selection?.decision?.requiresReview===true,
    blockingReasons:[...(selection?.decision?.blockingReasons||[])],
    warnings:[...(selection?.decision?.warnings||[])],
    supplierName:selected.supplierName??null,
    kitName:selected.kitName??null
  };
}

module.exports={
  PRICING_SOURCES,SELECTION_MODES,PROCUREMENT_BLOCKING_REASONS,
  ProcurementPricingValidationError,normalizeProcurementResult,canAutoPriceFromProcurement,
  selectProcurementCandidate,mapProcurementToPricingInput,buildProcurementSnapshot
};
