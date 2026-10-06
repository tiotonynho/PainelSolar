const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Pricing=require('../pricing-engine');
const Money=require('../money');
const SolarSizingEngine=require('../solar-sizing-engine');
const Matching=require('../kit-matching-engine');
const Procurement=require('../procurement-engine');

const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','pricing','fixtures.json'),'utf8'));
const silentLogger={info(){},warn(){}};

function assertLegacyFixture(fixture){
  const result=Pricing.calculatePricing(fixture.input);
  assert.equal(result.mode,'LEGACY');
  assert.equal(result.price.customerPrice,fixture.legacyInvestmentCents);
  assert.equal(result.legacy.investment,fixture.legacyInvestmentCents);
  assert.equal(result.costs.equipment,fixture.legacyBreakdownCents.equipment);
  assert.equal(result.costs.installation,fixture.legacyBreakdownCents.installation);
  assert.equal(result.costs.engineering,fixture.legacyBreakdownCents.engineering);
  assert.equal(result.commercial.taxAmount,fixture.legacyBreakdownCents.tax);
  assert.equal(result.costs.additionalServices,fixture.legacyBreakdownCents.services);
  if(fixture.legacyBreakdownCents.storage!==undefined)assert.equal(result.costs.storage,fixture.legacyBreakdownCents.storage);
  assert.equal(result.pricingComplete,true);
  assert.equal(result.requiresReview,false);
}

test('LEGACY mantém os três cenários representativos de proposta',()=>{
  for(const fixture of fixtures)assertLegacyFixture(fixture);
});

test('LEGACY preserva a fórmula do app e documenta margin como markup',()=>{
  const result=Pricing.calculateLegacyPricing({
    kitCost:1000,
    legacyRates:{marginRate:.2,installationRateDecimal:.1,engineeringRateDecimal:.05,taxRateDecimal:.08},
    additionalServices:[{quantity:1,unitValue:10}]
  });
  assert.equal(result.price.customerPrice,144000);
  assert.equal(result.commercial.markupAmount,20000);
  assert.equal(result.commercial.taxBase,'LEGACY_KIT_COST');
  assert.ok(result.warnings.includes('LEGACY_MARGIN_IS_MARKUP'));
});

test('STANDARD calcula somente equipamento e markup com centavos',()=>{
  const result=Pricing.calculatePricing({mode:'STANDARD',equipmentCostCents:10000,markupRate:.2});
  assert.equal(result.costs.directCost,10000);
  assert.equal(result.price.customerPrice,12000);
  assert.equal(result.commercial.grossProfit,2000);
  assert.equal(result.pricingComplete,true);
});

test('STANDARD separa custos diretos e serviços adicionais',()=>{
  const result=Pricing.calculatePricing({
    mode:'STANDARD',equipmentCost:100,freightCost:10,installationCost:20,engineeringCost:5,
    additionalServices:[{code:'SERVICE_A',cost:3.5}],markupRate:0
  });
  assert.equal(result.costs.directCost,13850);
  assert.equal(result.price.customerPrice,13850);
  assert.equal(result.costs.additionalServices,350);
});

test('frete conhecido pode ser zero, enquanto frete desconhecido exige revisão',()=>{
  const known=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,freightCost:0,markupRate:0});
  assert.equal(known.freightStatus,'KNOWN');
  assert.equal(known.pricingComplete,true);
  const unknown=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,freightRequired:true,markupRate:0});
  assert.equal(unknown.freightStatus,'UNKNOWN');
  assert.equal(unknown.price.customerPrice,null);
  assert.equal(unknown.pricingComplete,false);
  assert.equal(unknown.requiresReview,true);
  assert.ok(unknown.warnings.includes('FREIGHT_UNKNOWN'));
});

test('impostos exigem base explícita e podem usar custo direto',()=>{
  const missing=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,markupRate:0,taxRate:.1});
  assert.ok(missing.warnings.includes('TAX_CONFIGURATION_MISSING'));
  assert.equal(missing.price.customerPrice,null);
  const result=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,markupRate:0,taxRate:.1,taxBase:'DIRECT_COST'});
  assert.equal(result.commercial.taxAmount,1000);
  assert.equal(result.price.customerPrice,11000);
});

test('comissão exige base explícita e fica separada do lucro',()=>{
  const result=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,markupRate:.2,commissionRate:.05,commissionBase:'PRICE_BEFORE_TAX'});
  assert.equal(result.commercial.commissionAmount,600);
  assert.equal(result.price.customerPrice,12600);
  assert.equal(result.commercial.grossProfit,2000);
});

test('markup e margem alvo usam fórmulas diferentes',()=>{
  const markup=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,markupRate:.2});
  const margin=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,targetMarginRate:.2});
  assert.equal(markup.price.customerPrice,12000);
  assert.equal(margin.price.customerPrice,12500);
  assert.equal(margin.commercial.grossMarginRate,.2);
  assert.throws(()=>Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,markupRate:.2,targetMarginRate:.2}),/não podem/);
});

test('desconto e floorPrice são explicitamente sinalizados',()=>{
  const discounted=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,markupRate:.2,discountRate:.1});
  assert.equal(discounted.price.discountAmount,1200);
  assert.equal(discounted.price.customerPrice,10800);
  const below=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,markupRate:0,floorPrice:110});
  assert.equal(below.price.customerPrice,10000);
  assert.ok(below.warnings.includes('PRICE_BELOW_FLOOR'));
  assert.equal(below.requiresReview,true);
});

test('valida valores monetários inválidos e taxas fora do intervalo',()=>{
  assert.throws(()=>Pricing.calculatePricing({mode:'STANDARD',equipmentCost:-1,markupRate:0}),/não pode ser negativo/);
  assert.throws(()=>Pricing.calculatePricing({mode:'STANDARD',equipmentCost:'NaN',markupRate:0}),/inválido/);
  assert.throws(()=>Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,targetMarginRate:1}),/menor que 1/);
  assert.throws(()=>Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,markupRate:.2,discountRate:.1,discountAmount:1}),/não podem/);
});

test('money evita o erro clássico de ponto flutuante',()=>{
  assert.equal(Money.toCents(.1)+Money.toCents(.2),30);
  assert.equal(Money.toCents('0,10')+Money.toCents('0,20'),30);
  assert.equal(Money.toCents('1.234,56'),123456);
  assert.equal(Money.fromCents(30),.3);
});

test('zero é valor válido e não é confundido com dado ausente',()=>{
  const result=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:0,freightCost:0,markupRate:0});
  assert.equal(result.costs.equipment,0);
  assert.equal(result.costs.freight,0);
  assert.equal(result.price.customerPrice,0);
  assert.equal(result.pricingComplete,true);
});

test('fluxo de domínio sizing → matching → procurement → pricing',()=>{
  const sizing=SolarSizingEngine.calculateSizing({monthlyConsumptions:Array(12).fill(850),connectionType:'BIPHASIC',hsp:4.8,performanceRatio:.8,modulePowerWp:625});
  const module={id:'DEV-MODULE',category:'MODULE',specifications:{powerWp:625}};
  const kit={id:'KIT-8K',name:'DEV Kit 8 kWp',nominalPowerWp:8125,phaseType:'BIPHASIC',voltage:'220 V',active:true,items:[{kitId:'KIT-8K',productId:'DEV-MODULE',quantity:13,role:'MODULE',product:module}],supplierKits:[{id:'SUP-KIT',supplierId:'SUP-1',kitId:'KIT-8K',active:true,offers:[{id:'OFFER-1',price:15000,stockStatus:'AVAILABLE',leadTimeDays:3}]}]};
  const matching=Matching.matchKits({requiredDcPowerWp:sizing.requiredDcPowerWp,installedDcPowerWp:sizing.installedDcPowerWp,modulePowerWp:sizing.modulePowerWp,moduleCount:sizing.moduleCount,connectionType:sizing.connectionType,voltage:220},[kit],{logger:silentLogger});
  assert.equal(matching.matches.length,1);
  const procurement=Procurement.procure({compatibleKits:matching.matches,kits:[kit],suppliers:[{id:'SUP-1',active:true}],now:Date.now()},{logger:silentLogger,config:{autoRecommendation:{requireLandedCost:false,requireKnownStock:false,requireKnownSupplierLeadTime:false}}});
  assert.equal(procurement.bestOption?.equipmentPrice,15000);
  const pricing=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:procurement.bestOption.equipmentPrice,freightRequired:false,markupRate:.2});
  assert.equal(pricing.price.customerPrice,1800000);
  assert.equal(pricing.pricingComplete,true);
});

test('resultado de pricing não contém seleção de fornecedor como regra do motor',()=>{
  const result=Pricing.calculatePricing({mode:'STANDARD',equipmentCost:100,markupRate:0,supplierId:'SUP-SECRET',supplierScore:99,procurementScore:99});
  assert.equal(result.price.customerPrice,10000);
  assert.equal(result.supplierId,undefined);
  assert.equal(result.supplierScore,undefined);
  assert.equal(result.procurementScore,undefined);
});
