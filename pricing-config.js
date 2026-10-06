(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory();
  else root.PricingConfig=factory();
})(typeof window==='undefined'?globalThis:window,()=>{
'use strict';

const PRICING_MODES = Object.freeze({LEGACY: 'LEGACY', STANDARD: 'STANDARD'});
const TAX_BASES = Object.freeze({
  DIRECT_COST: 'DIRECT_COST',
  PRICE_BEFORE_TAX: 'PRICE_BEFORE_TAX',
  CUSTOMER_PRICE: 'CUSTOMER_PRICE',
  LEGACY_KIT_COST: 'LEGACY_KIT_COST'
});
const COMMISSION_BASES = Object.freeze({
  DIRECT_COST: 'DIRECT_COST',
  PRICE_BEFORE_TAX: 'PRICE_BEFORE_TAX'
});
const FREIGHT_STATUSES = Object.freeze({KNOWN: 'KNOWN', UNKNOWN: 'UNKNOWN', UNAVAILABLE: 'UNAVAILABLE', NOT_APPLICABLE: 'NOT_APPLICABLE'});

// Não há percentuais comerciais padrão neste módulo. Percentuais devem vir da
// proposta, de configuração administrativa aprovada ou do modo legado.
const PRICING_CONFIG = Object.freeze({
  currency: 'BRL',
  monetaryUnit: 'centavos',
  ratesUnit: 'decimal',
  modes: PRICING_MODES,
  taxBases: TAX_BASES,
  commissionBases: COMMISSION_BASES,
  freightStatuses: FREIGHT_STATUSES
});

return {PRICING_CONFIG, PRICING_MODES, TAX_BASES, COMMISSION_BASES, FREIGHT_STATUSES};
});
