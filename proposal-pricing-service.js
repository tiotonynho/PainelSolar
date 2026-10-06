'use strict';

const Pricing=require('./pricing-engine');
const {toCents,fromCents}=require('./money');
const {PRICING_MODES}=require('./pricing-config');
const {
  PRICING_SOURCES,SELECTION_MODES,
  ProcurementPricingValidationError,
  selectProcurementCandidate,mapProcurementToPricingInput,buildProcurementSnapshot
}=require('./procurement-pricing-bridge');

class ProposalPricingValidationError extends Error{
  constructor(message,details=[]){super(message);this.name='ProposalPricingValidationError';this.code='PROPOSAL_PRICING_VALIDATION';this.details=details;}
}

const has=(object,key)=>Object.prototype.hasOwnProperty.call(object,key)&&object[key]!==undefined&&object[key]!==null&&object[key]!=='';
const choose=(proposal,key,fallback)=>has(proposal,key)?proposal[key]:fallback;

function existingPriceSnapshot(proposal,now){
  let customerPriceCents;
  try{customerPriceCents=toCents(has(proposal,'customerPrice')?proposal.customerPrice:proposal.investment);}catch(error){throw new ProposalPricingValidationError('Preco existente da proposta invalido.');}
  return {
    pricingMode:proposal.pricingMode||PRICING_MODES.LEGACY,pricingSource:PRICING_SOURCES.LEGACY,selectionMode:null,commercialConfigVersion:proposal.commercialConfigVersion??null,calculatedAt:new Date(now).toISOString(),
    legacyInputAvailable:false,equipmentCostCents:null,freightCostCents:null,installationCostCents:null,engineeringCostCents:null,
    additionalServicesCostCents:null,directCostCents:null,taxRate:null,taxBase:null,taxAmountCents:null,commissionRate:null,
    commissionBase:null,commissionAmountCents:null,markupRate:null,targetMarginRate:null,markupAmountCents:null,grossProfitCents:null,
    grossMarginRate:null,discountAmountCents:null,floorPriceCents:null,customerPriceCents,pricingComplete:true,requiresReview:false,
    procurementDecision:null,procurementSnapshot:null,warnings:['LEGACY_INPUT_NOT_AVAILABLE'],reasons:['LEGACY_EXISTING_PRICE_PRESERVED']
  };
}

function snapshotFromResult(result,config,now,metadata={}){
  const costs=result.costs||{},commercial=result.commercial||{},price=result.price||{};
  return {
    pricingMode:result.mode,pricingSource:metadata.pricingSource||result.pricingSource||(result.mode===PRICING_MODES.LEGACY?PRICING_SOURCES.LEGACY:PRICING_SOURCES.MANUAL),selectionMode:metadata.selectionMode||null,
    commercialConfigVersion:config?.version??null,calculatedAt:new Date(now).toISOString(),
    legacyInputAvailable:result.mode!==PRICING_MODES.LEGACY||!result.legacy||result.legacy.investment!==undefined,
    equipmentCostCents:costs.equipment??null,freightCostCents:costs.freight??null,freightStatus:result.freightStatus??null,
    installationCostCents:costs.installation??null,engineeringCostCents:costs.engineering??null,additionalServicesCostCents:costs.additionalServices??null,
    storageCostCents:costs.storage??null,directCostCents:costs.directCost??null,taxRate:commercial.taxRate??null,taxBase:commercial.taxBase??null,
    taxAmountCents:commercial.taxAmount??null,commissionRate:commercial.commissionRate??null,commissionBase:commercial.commissionBase??null,
    commissionAmountCents:commercial.commissionAmount??null,markupRate:commercial.markupRate??null,targetMarginRate:commercial.targetMarginRate??null,
    markupAmountCents:commercial.markupAmount??null,grossProfitCents:commercial.grossProfit??null,grossMarginRate:commercial.grossMarginRate??null,
    discountAmountCents:price.discountAmount??null,floorPriceCents:price.floorPrice??null,customerPriceCents:price.customerPrice??null,
    pricingComplete:result.pricingComplete===true,requiresReview:result.requiresReview===true,warnings:[...(result.warnings||[])],reasons:[...(result.reasons||[])],
    procurementDecision:metadata.procurementDecision||null,procurementSnapshot:metadata.procurementSnapshot||null
  };
}

function incompleteProcurementResult(decision,mode=PRICING_MODES.STANDARD){
  const warnings=[...(decision?.warnings||[])];
  for(const reason of decision?.blockingReasons||[])if(!warnings.includes(reason))warnings.push(reason);
  return {
    mode,pricingComplete:false,requiresReview:true,warnings,reasons:['PROCUREMENT_REVIEW_REQUIRED'],
    costs:{equipment:null,freight:null,installation:0,engineering:0,additionalServices:0,storage:0,directCost:null},
    commercial:{markupRate:null,markupAmount:null,targetMarginRate:null,taxRate:null,taxBase:null,taxAmount:null,commissionRate:null,commissionBase:null,commissionAmount:null,grossProfit:null,grossMarginRate:null},
    price:{preDiscountPrice:null,discountAmount:0,customerPrice:null,floorPrice:null},freightStatus:null
  };
}

function standardInput(proposal,config){
  if(!config)throw new ProposalPricingValidationError('Nao existe CommercialConfig ativa para precificacao STANDARD.');
  return {
    mode:PRICING_MODES.STANDARD,
    equipmentCost:choose(proposal,'equipmentCost',choose(proposal,'kitCost',null)),
    equipmentCostCents:has(proposal,'equipmentCostCents')?proposal.equipmentCostCents:undefined,
    freightCost:choose(proposal,'freightCost',null),freightCostCents:has(proposal,'freightCostCents')?proposal.freightCostCents:undefined,
    freightStatus:choose(proposal,'freightStatus',undefined),freightRequired:has(proposal,'freightRequired')?proposal.freightRequired:config.defaultFreightRequired,
    installationCost:choose(proposal,'installationCost',undefined),installationCostCents:has(proposal,'installationCostCents')?proposal.installationCostCents:config.defaultInstallationCostCents,
    engineeringCost:choose(proposal,'engineeringCost',undefined),engineeringCostCents:has(proposal,'engineeringCostCents')?proposal.engineeringCostCents:config.defaultEngineeringCostCents,
    storageCost:choose(proposal,'storageCost',choose(proposal,'batteryCost',0)),
    additionalServices:proposal.additionalServices||[],additionalServicesCost:proposal.additionalServicesCost,
    markupRate:choose(proposal,'markupRate',config.defaultMarkupRate),targetMarginRate:choose(proposal,'targetMarginRate',config.defaultTargetMarginRate),
    taxRate:choose(proposal,'taxRate',config.defaultTaxRate),taxBase:choose(proposal,'taxBase',config.defaultTaxBase),
    commissionRate:choose(proposal,'commissionRate',config.defaultCommissionRate),commissionBase:choose(proposal,'commissionBase',config.defaultCommissionBase),
    discountRate:proposal.discountRate,discountAmount:proposal.discountAmount,floorPrice:proposal.floorPrice,minimumAllowedPrice:proposal.minimumAllowedPrice
  };
}

function priceProposal(proposal={},options={}){
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal))throw new ProposalPricingValidationError('Proposta invalida para precificacao.');
  const now=options.now??Date.now();
  let mode=String(proposal.pricingMode||options.config?.pricingMode||PRICING_MODES.LEGACY).toUpperCase();
  let pricingSource=String(proposal.pricingSource||options.pricingSource||(mode===PRICING_MODES.LEGACY?PRICING_SOURCES.LEGACY:PRICING_SOURCES.MANUAL)).toUpperCase();
  if(!Object.values(PRICING_SOURCES).includes(pricingSource))throw new ProposalPricingValidationError(`pricingSource invalido: ${pricingSource}`);
  if(pricingSource===PRICING_SOURCES.LEGACY)mode=PRICING_MODES.LEGACY;
  if(mode===PRICING_MODES.LEGACY)pricingSource=PRICING_SOURCES.LEGACY;
  if(pricingSource===PRICING_SOURCES.PROCUREMENT&&mode!==PRICING_MODES.STANDARD)throw new ProposalPricingValidationError('pricingSource PROCUREMENT exige pricingMode STANDARD.');
  let result,snapshot;
  const metadata={pricingSource,selectionMode:null,procurementDecision:null,procurementSnapshot:null};
  if(mode===PRICING_MODES.LEGACY){
    const hasLegacyInput=['kitCost','margin','installationRate','engineeringRate','taxRate','batteryCost','additionalServices'].some(key=>has(proposal,key));
    if(!hasLegacyInput&&!has(proposal,'equipmentCost')&&!has(proposal,'equipmentCostCents')&&has(proposal,'investment')){
      snapshot=existingPriceSnapshot({...proposal,pricingMode:mode},now);
      result={mode,pricingComplete:true,requiresReview:false,warnings:snapshot.warnings,reasons:snapshot.reasons,costs:{equipment:null,freight:null,installation:null,engineering:null,additionalServices:null,storage:null,directCost:null},commercial:{taxAmount:null,commissionAmount:null},price:{customerPrice:snapshot.customerPriceCents}};
    }else{
      result=Pricing.calculateLegacyPricing({...proposal,mode});snapshot=snapshotFromResult(result,options.config,now,metadata);
    }
  }else if(mode===PRICING_MODES.STANDARD){
    if(pricingSource===PRICING_SOURCES.PROCUREMENT){
      const procurementResult=options.procurementResult||proposal.procurementResult;
      const selectionMode=String(proposal.selectionMode||options.selectionMode||SELECTION_MODES.AUTO).toUpperCase();
      const freightRequired=proposal.procurementFreightRequired===undefined&&options.freightRequired===undefined?true:(proposal.procurementFreightRequired??options.freightRequired);
      let selection;
      try{
        selection=selectProcurementCandidate(procurementResult,{selectionMode,selectedOfferId:proposal.selectedOfferId??options.selectedOfferId,overrideReason:proposal.overrideReason??options.overrideReason,now,freightRequired});
      }catch(error){
        if(error instanceof ProcurementPricingValidationError)throw new ProposalPricingValidationError(error.message,error.details);
        throw error;
      }
      metadata.selectionMode=selection.selectionMode;metadata.procurementDecision=selection.decision;metadata.procurementSnapshot=buildProcurementSnapshot(selection,{selectedAt:now});
      if(selection.selectionMode===SELECTION_MODES.AUTO&&!selection.decision.canAutoPrice){
        result=incompleteProcurementResult(selection.decision);
      }else{
        const hardBlockers=['NO_BEST_OPTION','PRICE_UNKNOWN','INVALID_PRICE','FREIGHT_UNKNOWN','OUT_OF_STOCK','OFFER_EXPIRED','SUPPLIER_INACTIVE','KIT_INACTIVE','TECHNICAL_MATCH_INVALID','OFFER_INVALID'];
        const manualHardBlockers=selection.selectionMode===SELECTION_MODES.MANUAL?selection.decision.blockingReasons.filter(reason=>hardBlockers.includes(reason)):[];
        if(manualHardBlockers.length){
          const decision={...selection.decision,canAutoPrice:false,requiresReview:true,blockingReasons:manualHardBlockers};
          metadata.procurementDecision=decision;metadata.procurementSnapshot=buildProcurementSnapshot({...selection,decision},{selectedAt:now});result=incompleteProcurementResult(decision);
        }else try{
          const mapped=mapProcurementToPricingInput(selection,{freightRequired});
          const procurementProposal={...proposal,...mapped,pricingMode:PRICING_MODES.STANDARD};
          result=Pricing.calculateStandardPricing(standardInput(procurementProposal,options.config));
          if(selection.decision.requiresReview||selection.override){
            result.requiresReview=true;
            result.warnings=[...new Set([...(result.warnings||[]),...(selection.decision.blockingReasons||[]),...(selection.decision.warnings||[]),...(selection.override?['PROCUREMENT_MANUAL_OVERRIDE']:[])])];
          }
        }catch(error){
          const decision={canAutoPrice:false,requiresReview:true,blockingReasons:error.details||['MISSING_REQUIRED_DATA'],warnings:[]};
          metadata.procurementDecision=decision;metadata.procurementSnapshot=buildProcurementSnapshot({...selection,decision},{selectedAt:now});result=incompleteProcurementResult(decision);
        }
      }
      result.pricingSource=pricingSource;snapshot=snapshotFromResult(result,options.config,now,metadata);
    }else{
      result=Pricing.calculateStandardPricing(standardInput(proposal,options.config));result.pricingSource=pricingSource;snapshot=snapshotFromResult(result,options.config,now,metadata);
    }
  }else throw new ProposalPricingValidationError(`pricingMode invalido: ${mode}`);
  if(mode===PRICING_MODES.STANDARD&&options.config?.minimumMarginRate!==null&&options.config?.minimumMarginRate!==undefined&&result.commercial?.grossMarginRate!==null&&result.commercial?.grossMarginRate<options.config.minimumMarginRate){
    result.warnings=[...new Set([...(result.warnings||[]),'MINIMUM_MARGIN_BELOW_CONFIG'])];result.requiresReview=true;result.pricingComplete=false;snapshot=snapshotFromResult(result,options.config,now,metadata);
  }
  options.logger?.info?.({event:'PROPOSAL_PRICED',pricingMode:mode,pricingSource,commercialConfigVersion:options.config?.version??null,pricingComplete:result.pricingComplete,requiresReview:result.requiresReview});
  if(result.requiresReview)options.logger?.warn?.({event:'PRICING_REVIEW_REQUIRED',pricingMode:mode,pricingSource,warnings:result.warnings||[]});
  const customerPriceCents=result.price.customerPrice;
  const next={...proposal,pricingMode:mode,pricingSource,selectionMode:metadata.selectionMode,commercialConfigVersion:options.config?.version??proposal.commercialConfigVersion??null,pricingSnapshot:snapshot,customerPriceCents,customerPrice:customerPriceCents===null?null:fromCents(customerPriceCents)};
  delete next.procurementResult;
  if(customerPriceCents!==null)next.investment=fromCents(customerPriceCents);
  return {proposal:next,result,snapshot};
}

function recalculateProposalPricing(proposal,options={}){
  return priceProposal({...proposal,pricingMode:options.pricingMode||proposal.pricingMode||options.config?.pricingMode},options);
}

module.exports={ProposalPricingValidationError,priceProposal,recalculateProposalPricing,snapshotFromResult,existingPriceSnapshot,standardInput,PRICING_SOURCES,SELECTION_MODES};
