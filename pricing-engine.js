(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory(require('./money'),require('./pricing-config'));
  else root.PricingEngine=factory(root.PricingMoney,root.PricingConfig);
})(typeof window==='undefined'?globalThis:window,(Money,Config)=>{
'use strict';

const {
  toCents,
  addCents,
  sumCents,
  rateCents,
  assertCents
} = Money;
const {
  PRICING_MODES,
  TAX_BASES,
  COMMISSION_BASES,
  FREIGHT_STATUSES
} = Config;

const WARNING = Object.freeze({
  LEGACY_PRICING_MODE: 'LEGACY_PRICING_MODE',
  LEGACY_MARGIN_IS_MARKUP: 'LEGACY_MARGIN_IS_MARKUP',
  LEGACY_TAX_BASE_KIT_COST: 'LEGACY_TAX_BASE_KIT_COST',
  FREIGHT_NOT_IMPLEMENTED_IN_LEGACY: 'FREIGHT_NOT_IMPLEMENTED_IN_LEGACY',
  FREIGHT_UNKNOWN: 'FREIGHT_UNKNOWN',
  FREIGHT_DATA_INCONSISTENT: 'FREIGHT_DATA_INCONSISTENT',
  PRICING_CONFIGURATION_MISSING: 'PRICING_CONFIGURATION_MISSING',
  TAX_CONFIGURATION_MISSING: 'TAX_CONFIGURATION_MISSING',
  COMMISSION_CONFIGURATION_MISSING: 'COMMISSION_CONFIGURATION_MISSING',
  DISCOUNT_EXCEEDS_PRICE: 'DISCOUNT_EXCEEDS_PRICE',
  PRICE_BELOW_FLOOR: 'PRICE_BELOW_FLOOR',
  MARGIN_BELOW_TARGET: 'MARGIN_BELOW_TARGET',
  LEGACY_UNIMPLEMENTED_FIELD: 'LEGACY_UNIMPLEMENTED_FIELD'
});

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function invalid(message) {
  throw new TypeError(message);
}

function readMoney(input, name, options = {}) {
  const centsName = `${name}Cents`;
  if (hasValue(input[centsName])) {
    const cents = typeof input[centsName] === 'number' ? input[centsName] : Number(input[centsName]);
    if (!Number.isSafeInteger(cents) || cents < 0) invalid(`${centsName} inválido`);
    return cents;
  }
  if (hasValue(input[name])) return toCents(input[name], options);
  return options.defaultValue === undefined ? null : options.defaultValue;
}

function readRate(value, name, {maximum = Infinity} = {}) {
  if (!hasValue(value)) return null;
  const rate = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(rate) || rate < 0 || rate > maximum) invalid(`${name} inválido`);
  return rate;
}

function readLegacyRate(input, rateName, percentName) {
  if (input.legacyRates) {
    const legacyValue = input.legacyRates[rateName] ?? input.legacyRates[percentName];
    if (hasValue(legacyValue)) return readRate(legacyValue, `legacyRates.${rateName}`);
  }
  if (hasValue(input[rateName])) return readRate(input[rateName], rateName);
  if (hasValue(input[percentName])) {
    const percent = Number(String(input[percentName]).replace(',', '.'));
    if (!Number.isFinite(percent) || percent < 0) invalid(`${percentName} inválido`);
    return percent / 100;
  }
  return 0;
}

function normalizeServices(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) invalid('additionalServices deve ser um array');
  return input.map((service, index) => {
    if (!service || typeof service !== 'object') invalid(`Serviço adicional ${index} inválido`);
    let costCents = readMoney(service, 'cost', {defaultValue: null});
    if (costCents === null && hasValue(service.total)) costCents = toCents(service.total);
    if (costCents === null && hasValue(service.unitValue)) {
      const quantity = Number(service.quantity ?? 1);
      if (!Number.isFinite(quantity) || quantity < 0) invalid(`Quantidade do serviço ${index} inválida`);
      const unitCents = toCents(service.unitValue);
      costCents = assertCents(Math.round(unitCents * quantity), `Serviço ${index}`);
    }
    if (costCents === null) costCents = 0;
    return {
      code: service.code ?? service.field ?? null,
      description: service.description ?? service.label ?? null,
      quantity: service.quantity === undefined ? null : service.quantity,
      costCents
    };
  });
}

function resolveFreight(input) {
  const cost = readMoney(input, 'freightCost', {defaultValue: null});
  const explicitStatus = hasValue(input.freightStatus) ? String(input.freightStatus).toUpperCase() : null;
  const required = input.freightRequired === true;
  let status = explicitStatus;

  if (status && !Object.values(FREIGHT_STATUSES).includes(status)) invalid('freightStatus inválido');
  if (!status) {
    if (cost !== null) status = FREIGHT_STATUSES.KNOWN;
    else if (required) status = FREIGHT_STATUSES.UNKNOWN;
    else status = FREIGHT_STATUSES.NOT_APPLICABLE;
  }

  const warnings = [];
  if (status === FREIGHT_STATUSES.KNOWN && cost === null) {
    status = FREIGHT_STATUSES.UNKNOWN;
    warnings.push(WARNING.FREIGHT_UNKNOWN);
  }
  if ([FREIGHT_STATUSES.UNKNOWN, FREIGHT_STATUSES.UNAVAILABLE, FREIGHT_STATUSES.NOT_APPLICABLE].includes(status) && cost !== null) {
    warnings.push(WARNING.FREIGHT_DATA_INCONSISTENT);
  }
  return {status, costCents: status === FREIGHT_STATUSES.KNOWN ? cost : null, warnings};
}

function calculateMarkupPrice(directCostCents, markupRate) {
  assertCents(directCostCents, 'Custo direto');
  return addCents(directCostCents, rateCents(directCostCents, markupRate));
}

function calculateMarginPrice(directCostCents, targetMarginRate) {
  assertCents(directCostCents, 'Custo direto');
  if (!Number.isFinite(targetMarginRate) || targetMarginRate < 0 || targetMarginRate >= 1) {
    invalid('targetMarginRate deve estar entre 0 e 1, exclusive no limite superior');
  }
  return assertCents(Math.round(directCostCents / (1 - targetMarginRate)), 'Preço por margem');
}

function calculateTaxAmount({rate, baseCents, base}) {
  if (rate === null || rate === 0) return {amountCents: 0, baseCents: baseCents ?? null};
  if (baseCents === null) return {amountCents: null, baseCents: null};
  if (base === TAX_BASES.CUSTOMER_PRICE) {
    if (rate >= 1) invalid('taxRate não pode ser 1 ou maior');
    return {amountCents: assertCents(Math.round((baseCents * rate) / (1 - rate)), 'Imposto'), baseCents};
  }
  return {amountCents: rateCents(baseCents, rate), baseCents};
}

function calculateCommissionAmount({rate, baseCents}) {
  if (rate === null || rate === 0) return {amountCents: 0, baseCents: baseCents ?? null};
  if (baseCents === null) return {amountCents: null, baseCents: null};
  return {amountCents: rateCents(baseCents, rate), baseCents};
}

function baseResult(mode, warnings = [], reasons = []) {
  return {
    mode,
    costs: {
      equipment: null,
      freight: null,
      installation: 0,
      engineering: 0,
      additionalServices: 0,
      storage: 0,
      directCost: null
    },
    commercial: {
      markupRate: null,
      markupAmount: null,
      targetMarginRate: null,
      taxRate: null,
      taxBase: null,
      taxAmount: 0,
      commissionRate: null,
      commissionBase: null,
      commissionAmount: 0,
      grossProfit: null,
      grossMarginRate: null
    },
    price: {
      preDiscountPrice: null,
      discountAmount: 0,
      customerPrice: null,
      floorPrice: null
    },
    freightStatus: null,
    pricingComplete: false,
    requiresReview: true,
    reasons,
    warnings
  };
}

function calculateLegacyPricing(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Pricing input inválido');
  const result = baseResult(PRICING_MODES.LEGACY, [WARNING.LEGACY_PRICING_MODE, WARNING.FREIGHT_NOT_IMPLEMENTED_IN_LEGACY], [WARNING.LEGACY_PRICING_MODE]);
  const servicesQuote = input.servicesQuote === true || input.quoteType === 'services';
  const kitCents = servicesQuote ? 0 : (readMoney(input, 'kitCost', {defaultValue: readMoney(input, 'equipmentCost', {defaultValue: 0})}) ?? 0);
  const hybrid = !servicesQuote && input.hybrid === true;
  const storageCents = hybrid ? (readMoney(input, 'batteryCost', {defaultValue: readMoney(input, 'storageCost', {defaultValue: 0})}) ?? 0) : 0;
  const services = normalizeServices(input.additionalServices);
  const explicitServices = readMoney(input, 'additionalServicesCost', {defaultValue: null});
  const serviceCents = explicitServices === null ? sumCents(services.map(service => service.costCents)) : explicitServices;
  const marginRate = readLegacyRate(input, 'marginRate', 'margin');
  const installationRate = readLegacyRate(input, 'installationRateDecimal', 'installationRate');
  const engineeringRate = readLegacyRate(input, 'engineeringRateDecimal', 'engineeringRate');
  const taxRate = readLegacyRate(input, 'taxRateDecimal', 'taxRate');
  const marginCents = rateCents(kitCents, marginRate);
  const installationCents = rateCents(kitCents, installationRate);
  const engineeringCents = rateCents(kitCents, engineeringRate);
  const taxCents = rateCents(kitCents, taxRate);
  const totalCents = addCents(kitCents, marginCents, installationCents, engineeringCents, taxCents, storageCents, serviceCents);
  const directCostCents = addCents(kitCents, installationCents, engineeringCents, storageCents, serviceCents);
  const grossProfitCents = totalCents - directCostCents - taxCents;

  result.costs = {
    equipment: kitCents,
    freight: null,
    installation: installationCents,
    engineering: engineeringCents,
    additionalServices: serviceCents,
    storage: storageCents,
    directCost: directCostCents
  };
  result.commercial = {
    markupRate: marginRate,
    markupAmount: marginCents,
    targetMarginRate: null,
    taxRate,
    taxBase: TAX_BASES.LEGACY_KIT_COST,
    taxBaseCents: kitCents,
    taxAmount: taxCents,
    commissionRate: 0,
    commissionBase: null,
    commissionAmount: 0,
    grossProfit: grossProfitCents,
    grossMarginRate: totalCents === 0 ? null : grossProfitCents / totalCents
  };
  result.price = {preDiscountPrice: totalCents, discountAmount: 0, customerPrice: totalCents, floorPrice: null};
  result.freightStatus = 'NOT_IMPLEMENTED_IN_LEGACY';
  result.pricingComplete = true;
  result.requiresReview = false;
  result.reasons.push(WARNING.LEGACY_MARGIN_IS_MARKUP, WARNING.LEGACY_TAX_BASE_KIT_COST);
  result.warnings.push(WARNING.LEGACY_MARGIN_IS_MARKUP, WARNING.LEGACY_TAX_BASE_KIT_COST);
  result.legacy = {
    servicesQuote,
    hybrid,
    kitCost: kitCents,
    storageCost: storageCents,
    serviceCost: serviceCents,
    marginCost: marginCents,
    installationCost: installationCents,
    engineeringCost: engineeringCents,
    taxCost: taxCents,
    investment: totalCents
  };
  return result;
}

function calculateStandardPricing(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Pricing input inválido');
  const warnings = [];
  const reasons = ['STANDARD_PRICING_MODE'];
  const result = baseResult(PRICING_MODES.STANDARD, warnings, reasons);
  const equipmentCents = readMoney(input, 'equipmentCost', {defaultValue: null});
  if (equipmentCents === null) warnings.push('EQUIPMENT_COST_MISSING');
  const installationCents = readMoney(input, 'installationCost', {defaultValue: 0});
  const engineeringCents = readMoney(input, 'engineeringCost', {defaultValue: 0});
  const storageCents = readMoney(input, 'storageCost', {defaultValue: readMoney(input, 'batteryCost', {defaultValue: 0})});
  const services = normalizeServices(input.additionalServices);
  const explicitServices = readMoney(input, 'additionalServicesCost', {defaultValue: null});
  const serviceCents = explicitServices === null ? sumCents(services.map(service => service.costCents)) : explicitServices;
  const freight = resolveFreight(input);
  warnings.push(...freight.warnings);
  if (freight.status === FREIGHT_STATUSES.UNKNOWN || freight.status === FREIGHT_STATUSES.UNAVAILABLE) warnings.push(WARNING.FREIGHT_UNKNOWN);
  const directCostCents = equipmentCents === null || freight.status !== FREIGHT_STATUSES.KNOWN && freight.status !== FREIGHT_STATUSES.NOT_APPLICABLE
    ? null
    : addCents(equipmentCents, freight.costCents ?? 0, installationCents, engineeringCents, serviceCents, storageCents);

  result.costs = {
    equipment: equipmentCents,
    freight: freight.costCents,
    installation: installationCents,
    engineering: engineeringCents,
    additionalServices: serviceCents,
    storage: storageCents,
    directCost: directCostCents
  };
  result.freightStatus = freight.status;

  const markupRate = readRate(input.markupRate, 'markupRate');
  const targetMarginRate = readRate(input.targetMarginRate, 'targetMarginRate', {maximum: 1});
  if (targetMarginRate === 1) invalid('targetMarginRate deve ser menor que 1');
  result.commercial.markupRate = markupRate;
  result.commercial.targetMarginRate = targetMarginRate;

  let basePriceCents = null;
  if (directCostCents !== null && markupRate !== null && targetMarginRate !== null) invalid('markupRate e targetMarginRate não podem ser usados juntos');
  if (directCostCents !== null && markupRate !== null) {
    basePriceCents = calculateMarkupPrice(directCostCents, markupRate);
    reasons.push('MARKUP_PRICING');
    result.commercial.markupAmount = basePriceCents - directCostCents;
  } else if (directCostCents !== null && targetMarginRate !== null) {
    basePriceCents = calculateMarginPrice(directCostCents, targetMarginRate);
    reasons.push('TARGET_MARGIN_PRICING');
    result.commercial.markupAmount = basePriceCents - directCostCents;
  } else if (directCostCents !== null) {
    warnings.push(WARNING.PRICING_CONFIGURATION_MISSING);
  }

  const discountRate = readRate(input.discountRate, 'discountRate', {maximum: 1});
  const explicitDiscount = readMoney(input, 'discountAmount', {defaultValue: null});
  if (discountRate !== null && explicitDiscount !== null) invalid('discountRate e discountAmount não podem ser usados juntos');
  let discountCents = 0;
  if (basePriceCents !== null) discountCents = discountRate === null ? (explicitDiscount ?? 0) : rateCents(basePriceCents, discountRate);
  if (basePriceCents !== null && discountCents > basePriceCents) warnings.push(WARNING.DISCOUNT_EXCEEDS_PRICE);
  const priceBeforeTaxCents = basePriceCents === null ? null : Math.max(0, basePriceCents - discountCents);

  const taxRate = readRate(input.taxRate, 'taxRate', {maximum: 1});
  const taxBase = hasValue(input.taxBase) ? String(input.taxBase).toUpperCase() : null;
  let taxBaseCents = null;
  if (taxRate !== null && taxRate > 0) {
    if (!taxBase || !Object.values(TAX_BASES).includes(taxBase) || taxBase === TAX_BASES.LEGACY_KIT_COST) warnings.push(WARNING.TAX_CONFIGURATION_MISSING);
    else if (taxBase === TAX_BASES.DIRECT_COST) taxBaseCents = directCostCents;
    else taxBaseCents = priceBeforeTaxCents;
  }
  const tax = taxRate === null || taxRate === 0 ? {amountCents: 0, baseCents: null} : calculateTaxAmount({rate: taxRate, baseCents: taxBaseCents, base: taxBase});
  if (taxRate > 0 && tax.amountCents === null) warnings.push(WARNING.TAX_CONFIGURATION_MISSING);

  const commissionRate = readRate(input.commissionRate, 'commissionRate', {maximum: 1});
  const commissionBase = hasValue(input.commissionBase) ? String(input.commissionBase).toUpperCase() : null;
  let commissionBaseCents = null;
  if (commissionRate !== null && commissionRate > 0) {
    if (!commissionBase || !Object.values(COMMISSION_BASES).includes(commissionBase)) warnings.push(WARNING.COMMISSION_CONFIGURATION_MISSING);
    else commissionBaseCents = commissionBase === COMMISSION_BASES.DIRECT_COST ? directCostCents : priceBeforeTaxCents;
  }
  const commission = commissionRate === null || commissionRate === 0 ? {amountCents: 0, baseCents: null} : calculateCommissionAmount({rate: commissionRate, baseCents: commissionBaseCents});
  if (commissionRate > 0 && commission.amountCents === null) warnings.push(WARNING.COMMISSION_CONFIGURATION_MISSING);

  const blockingWarnings = new Set(['EQUIPMENT_COST_MISSING', WARNING.FREIGHT_UNKNOWN, WARNING.FREIGHT_DATA_INCONSISTENT, WARNING.PRICING_CONFIGURATION_MISSING, WARNING.TAX_CONFIGURATION_MISSING, WARNING.COMMISSION_CONFIGURATION_MISSING, WARNING.DISCOUNT_EXCEEDS_PRICE]);
  const hasBlockingWarning = warnings.some(warning => blockingWarnings.has(warning));
  const customerPriceCents = priceBeforeTaxCents === null || hasBlockingWarning ? null : addCents(priceBeforeTaxCents, tax.amountCents ?? 0, commission.amountCents ?? 0);
  const floorCents = readMoney(input, 'floorPrice', {defaultValue: readMoney(input, 'minimumAllowedPrice', {defaultValue: null})});
  if (customerPriceCents !== null && floorCents !== null && customerPriceCents < floorCents) warnings.push(WARNING.PRICE_BELOW_FLOOR);
  const grossProfitCents = customerPriceCents === null || directCostCents === null ? null : customerPriceCents - directCostCents - (tax.amountCents ?? 0) - (commission.amountCents ?? 0);
  const grossMarginRate = grossProfitCents === null || customerPriceCents === 0 ? null : grossProfitCents / customerPriceCents;
  if (targetMarginRate !== null && grossMarginRate !== null && grossMarginRate < targetMarginRate - 0.0000001) warnings.push(WARNING.MARGIN_BELOW_TARGET);

  result.commercial = {
    markupRate,
    markupAmount: result.commercial.markupAmount,
    targetMarginRate,
    taxRate: taxRate ?? 0,
    taxBase,
    taxBaseCents: tax.baseCents,
    taxAmount: tax.amountCents ?? 0,
    commissionRate: commissionRate ?? 0,
    commissionBase,
    commissionBaseCents: commission.baseCents,
    commissionAmount: commission.amountCents ?? 0,
    grossProfit: grossProfitCents,
    grossMarginRate
  };
  result.price = {
    preDiscountPrice: basePriceCents,
    discountAmount: discountCents,
    priceBeforeTax: priceBeforeTaxCents,
    customerPrice: customerPriceCents,
    floorPrice: floorCents
  };
  result.warnings = [...new Set(warnings)];
  result.pricingComplete = !result.warnings.some(warning => blockingWarnings.has(warning)) && customerPriceCents !== null;
  result.requiresReview = !result.pricingComplete || result.warnings.length > 0;
  return result;
}

function calculatePricing(input = {}) {
  const mode = String(input.mode ?? PRICING_MODES.STANDARD).toUpperCase();
  if (mode === PRICING_MODES.LEGACY) return calculateLegacyPricing(input);
  if (mode === PRICING_MODES.STANDARD) return calculateStandardPricing(input);
  invalid(`Modo de pricing inválido: ${mode}`);
}

return {
  WARNING,
  calculatePricing,
  calculateLegacyPricing,
  calculateStandardPricing,
  calculateMarkupPrice,
  calculateMarginPrice,
  calculateTaxAmount,
  calculateCommissionAmount,
  normalizeServices
};
});
