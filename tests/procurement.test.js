const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Procurement=require('../procurement-engine');
const SupplierScore=require('../supplier-score');
const Freight=require('../freight-quote');
const SolarSizing=require('../solar-sizing-engine');
const Matching=require('../kit-matching-engine');
const {openDatabase}=require('../db');
const {createCatalogService}=require('../catalog-service');
const {createKitService}=require('../kit-service');
const {seedDevelopmentCatalog}=require('../catalog-seed');

const NOW=1_700_000_000_000;
const POSTAL_CODE='88000000';
const silentLogger={info(){},warn(){}};

function supplier(id,options={}){
  return {id,name:options.name||id,active:options.active===undefined?true:options.active};
}

function offer(id,options={}){
  return {
    id,
    price:options.price===undefined?10000:options.price,
    currency:'BRL',
    stockStatus:options.stockStatus||'AVAILABLE',
    stockQuantity:options.stockQuantity===undefined?10:options.stockQuantity,
    leadTimeDays:options.leadTimeDays===undefined?5:options.leadTimeDays,
    validUntil:options.validUntil===undefined?NOW+86400000:options.validUntil
  };
}

function freight(supplierId,supplierKitId,options={}){
  return {
    supplierId,supplierKitId,postalCode:POSTAL_CODE,status:options.status||'KNOWN',
    cost:options.cost===undefined?500:options.cost,
    estimatedDays:options.estimatedDays===undefined?2:options.estimatedDays,
    quotedAt:NOW,expiresAt:options.expiresAt===undefined?NOW+86400000:options.expiresAt
  };
}

function kit(id='KIT-1',supplierKits=[]){
  const product={id:`${id}-MODULE`,category:'MODULE',manufacturer:'DEV',model:'Module625',specifications:{powerWp:625}};
  return {
    id,name:id,nominalPowerWp:8125,phaseType:'BIPHASIC',voltage:'127/220 V',active:true,
    items:[{id:`${id}-ITEM`,kitId:id,productId:product.id,quantity:13,role:'MODULE',product}],
    supplierKits
  };
}

function supplierKit(id,supplierValue,offers,options={}){
  return {id,supplierId:supplierValue.id,kitId:options.kitId||'KIT-1',supplierName:`${supplierValue.name} Kit`,active:options.active===undefined?true:options.active,supplier:supplierValue,offers};
}

function match(kitId,technicalScore=96,options={}){
  return {kitId,technicalScore,classification:options.classification||'EXACT'};
}

function run(compatibleKits,kits,options={}){
  return Procurement.procure({
    compatibleKits,kits,destinationPostalCode:POSTAL_CODE,now:NOW,
    freightQuotes:options.freightQuotes||[],supplierScores:options.supplierScores||[]
  },{logger:silentLogger,config:options.config});
}

test('SupplierScore permanece UNKNOWN sem histórico e calcula métricas configuradas',()=>{
  const unknown=SupplierScore.calculateSupplierScore(supplier('SUP-UNKNOWN'),{weights:{deliveryReliability:1}});
  assert.equal(unknown.status,'UNKNOWN');
  assert.equal(unknown.score,null);
  assert.ok(unknown.warnings.includes('SUPPLIER_RELIABILITY_UNKNOWN'));
  const known=SupplierScore.calculateSupplierScore(supplier('SUP-KNOWN'),{
    weights:{deliveryReliability:1},metrics:{deliveryReliability:88}
  });
  assert.equal(known.status,'KNOWN');
  assert.equal(known.score,88);
});

test('mesmo kit com dois fornecedores escolhe menor landedCost',()=>{
  const a=supplier('SUP-A'),b=supplier('SUP-B');
  const kitValue=kit('KIT-A',[supplierKit('SK-A',a,[offer('O-A',{price:10000})]),supplierKit('SK-B',b,[offer('O-B',{price:10500})])]);
  const result=run([match(kitValue.id)], [kitValue], {freightQuotes:[freight(a.id,'SK-A',{cost:500}),freight(b.id,'SK-B',{cost:500})]});
  assert.equal(result.bestOption.supplierId,'SUP-A');
  assert.equal(result.bestOption.landedCost,10500);
  assert.equal(result.bestOption.reasons.includes('BEST_LANDED_COST'),true);
  assert.equal(result.alternatives.length,1);
});

test('frete maior pode tornar a oferta mais cara apesar do equipamento menor',()=>{
  const a=supplier('SUP-A'),b=supplier('SUP-B');
  const kitValue=kit('KIT-B',[supplierKit('SK-A',a,[offer('O-A',{price:9000})]),supplierKit('SK-B',b,[offer('O-B',{price:9500})])]);
  const result=run([match(kitValue.id)], [kitValue], {freightQuotes:[freight(a.id,'SK-A',{cost:2500}),freight(b.id,'SK-B',{cost:500})]});
  assert.equal(result.bestOption.supplierId,'SUP-B');
  assert.equal(result.bestOption.landedCost,10000);
  assert.equal(result.alternatives[0].landedCost,11500);
});

test('prazo muito menor pode superar diferença de preço com configuração explícita',()=>{
  const a=supplier('SUP-A'),b=supplier('SUP-B');
  const kitValue=kit('KIT-C',[supplierKit('SK-A',a,[offer('O-A',{price:10000,leadTimeDays:30})]),supplierKit('SK-B',b,[offer('O-B',{price:10500,leadTimeDays:2})])]);
  const result=run([match(kitValue.id)], [kitValue], {
    freightQuotes:[freight(a.id,'SK-A',{cost:500}),freight(b.id,'SK-B',{cost:500})],
    config:{weights:{price:.1,freight:.1,leadTime:.5,stock:.1,reliability:.1,technical:.1}}
  });
  assert.equal(result.bestOption.supplierId,'SUP-B');
  assert.ok(result.bestOption.reasons.includes('SHORT_LEAD_TIME'));
});

test('OUT_OF_STOCK é rejeitado e não vira melhor opção',()=>{
  const s=supplier('SUP-OUT');
  const kitValue=kit('KIT-D',[supplierKit('SK-D',s,[offer('O-D',{stockStatus:'OUT_OF_STOCK'})])]);
  const result=run([match(kitValue.id)], [kitValue]);
  assert.equal(result.bestOption,null);
  assert.ok(result.rejected[0].reasons.includes('OUT_OF_STOCK'));
});

test('estoque UNKNOWN permanece desconhecido e exige revisão',()=>{
  const s=supplier('SUP-UNKNOWN-STOCK');
  const kitValue=kit('KIT-E',[supplierKit('SK-E',s,[offer('O-E',{stockStatus:'UNKNOWN'})])]);
  const result=run([match(kitValue.id)], [kitValue], {freightQuotes:[freight(s.id,'SK-E')]});
  assert.equal(result.bestOption,null);
  assert.equal(result.alternatives.length,1);
  assert.equal(result.alternatives[0].stockQuantity,10);
  assert.equal(result.alternatives[0].procurementScore!==null,true);
  assert.ok(result.warnings.includes('STOCK_UNKNOWN'));
  assert.equal(result.requiresReview,true);
});

test('frete desconhecido não vira zero e landedCost permanece null',()=>{
  const s=supplier('SUP-NO-FREIGHT');
  const kitValue=kit('KIT-F',[supplierKit('SK-F',s,[offer('O-F',{price:12000})])]);
  const result=run([match(kitValue.id)], [kitValue]);
  assert.equal(result.bestOption,null);
  assert.equal(result.alternatives[0].freightCost,null);
  assert.equal(result.alternatives[0].freightStatus,'UNKNOWN');
  assert.equal(result.alternatives[0].landedCost,null);
  assert.ok(result.warnings.includes('FREIGHT_UNKNOWN'));
});

test('oferta expirada é rejeitada',()=>{
  const s=supplier('SUP-EXPIRED');
  const kitValue=kit('KIT-G',[supplierKit('SK-G',s,[offer('O-G',{validUntil:NOW})])]);
  const result=run([match(kitValue.id)], [kitValue]);
  assert.ok(result.rejected[0].reasons.includes('OFFER_EXPIRED'));
});

test('fornecedor inativo é rejeitado',()=>{
  const s=supplier('SUP-INACTIVE',{active:false});
  const kitValue=kit('KIT-H',[supplierKit('SK-H',s,[offer('O-H')])]);
  const result=run([match(kitValue.id)], [kitValue], {freightQuotes:[freight(s.id,'SK-H')]});
  assert.ok(result.rejected[0].reasons.includes('SUPPLIER_INACTIVE'));
});

test('SupplierScore UNKNOWN preserva score nulo e exige revisão mesmo com oferta adquirível',()=>{
  const s=supplier('SUP-SCORE-UNKNOWN');
  const kitValue=kit('KIT-I',[supplierKit('SK-I',s,[offer('O-I')])]);
  const result=run([match(kitValue.id)], [kitValue], {freightQuotes:[freight(s.id,'SK-I')]});
  assert.equal(result.bestOption.supplierScore,null);
  assert.equal(result.bestOption.supplierScoreStatus,'UNKNOWN');
  assert.equal(result.requiresReview,true);
  assert.ok(result.bestOption.warnings.includes('SUPPLIER_RELIABILITY_UNKNOWN'));
});

test('todos os dados conhecidos permitem bestOption sem revisão',()=>{
  const s=supplier('SUP-KNOWN');
  const kitValue=kit('KIT-J',[supplierKit('SK-J',s,[offer('O-J')])]);
  const result=run([match(kitValue.id)], [kitValue], {
    freightQuotes:[freight(s.id,'SK-J')],
    supplierScores:{[s.id]:{deliveryReliability:90,stockAccuracy:90,priceConsistency:90,supportQuality:90,warrantyHandling:90,orderSuccessRate:90}}
  });
  assert.ok(result.bestOption);
  assert.equal(result.bestOption.supplierScore,90);
  assert.equal(result.requiresReview,false);
  assert.equal(result.warnings.length,0);
});

test('nenhuma oferta válida retorna rejeições e bestOption nulo',()=>{
  const s=supplier('SUP-NONE');
  const kitValue=kit('KIT-K',[supplierKit('SK-K',s,[offer('O-K',{price:null})])]);
  const result=run([match(kitValue.id)], [kitValue]);
  assert.equal(result.bestOption,null);
  assert.ok(result.rejected[0].reasons.includes('INVALID_PRICE'));
  assert.ok(result.warnings.includes('NO_VALID_OFFERS'));
});

test('empate é determinístico por supplierId e offerId',()=>{
  const a=supplier('SUP-A-TIE'),b=supplier('SUP-B-TIE');
  const kitValue=kit('KIT-L',[supplierKit('SK-A',a,[offer('O-A')]),supplierKit('SK-B',b,[offer('O-B')])]);
  const result=run([match(kitValue.id)], [kitValue], {freightQuotes:[freight(a.id,'SK-A'),freight(b.id,'SK-B')]});
  assert.equal(result.bestOption.supplierId,'SUP-A-TIE');
  assert.equal(result.alternatives[0].supplierId,'SUP-B-TIE');
  assert.equal(result.requiresReview,true);
  assert.ok(result.warnings.includes('OFFERS_TOO_CLOSE'));
});

test('múltiplos kits compatíveis são classificados no mesmo ranking comercial',()=>{
  const s1=supplier('SUP-M-1'),s2=supplier('SUP-M-2');
  const first=kit('KIT-M-1',[supplierKit('SK-M-1',s1,[offer('O-M-1',{price:11000})])]);
  const second=kit('KIT-M-2',[supplierKit('SK-M-2',s2,[offer('O-M-2',{price:10000})])]);
  const result=run([match(first.id,92),match(second.id,98)],[first,second],{freightQuotes:[freight(s1.id,'SK-M-1'),freight(s2.id,'SK-M-2')]});
  assert.equal(result.bestOption.kitId,'KIT-M-2');
  assert.equal(result.alternatives[0].kitId,'KIT-M-1');
});

test('oferta barata de kit fora dos CompatibleKits não é considerada',()=>{
  const s=supplier('SUP-OUTSIDE');
  const compatible=kit('KIT-MATCHED',[supplierKit('SK-MATCHED',s,[offer('O-MATCHED',{price:12000})])]);
  const incompatible=kit('KIT-NOT-MATCHED',[supplierKit('SK-NOT-MATCHED',s,[offer('O-NOT-MATCHED',{price:1})])]);
  const result=run([match(compatible.id)],[compatible,incompatible],{freightQuotes:[freight(s.id,'SK-MATCHED',{cost:500}),freight(s.id,'SK-NOT-MATCHED',{cost:0})]});
  assert.equal(result.bestOption.kitId,'KIT-MATCHED');
  assert.equal(result.evaluatedTechnicalKits,1);
  assert.equal(result.alternatives.length,0);
});

test('FreightQuote normaliza CEP, estados e validade',()=>{
  assert.equal(Freight.normalizePostalCode('88000-000'),POSTAL_CODE);
  assert.equal(Freight.normalizeFreightQuote({supplierId:'S',supplierKitId:'SK',status:'UNKNOWN'}).cost,null);
  assert.throws(()=>Freight.normalizeFreightQuote({supplierId:'S',supplierKitId:'SK',status:'KNOWN'}),/custo válido/);
  const quote=Freight.normalizeFreightQuote(freight('S','SK'));
  assert.equal(Freight.findFreightQuote([quote],{supplierId:'S',supplierKitId:'SK',postalCode:POSTAL_CODE},NOW).quote.status,'KNOWN');
  assert.equal(Freight.findFreightQuote([Freight.normalizeFreightQuote(freight('S','SK',{expiresAt:NOW}))],{supplierId:'S',supplierKitId:'SK',postalCode:POSTAL_CODE},NOW).reason,'FREIGHT_QUOTE_EXPIRED');
});

test('fluxo end-to-end usa SolarSizing, Matching e Procurement com dados DEV',()=>{
  const dataDir=path.join(__dirname,'tmp','procurement-'+crypto.randomUUID());
  fs.mkdirSync(dataDir,{recursive:true});
  const db=openDatabase(dataDir);
  try{
    seedDevelopmentCatalog(db);
    const catalog=createCatalogService(db);
    const kitService=createKitService(db);
    const supplier=catalog.findSupplierBySlug('aldo-solar');
    const kitValue=kitService.findKitBySlug('dev-kit-8-125-kwp');
    const supplierKit=kitService.createSupplierKit({id:'SK-DEV-PROC',supplierId:supplier.id,kitId:kitValue.id,supplierSku:'DEV-PROC',supplierName:'Oferta DEV'});
    kitService.createSupplierKitOffer({id:'O-DEV-PROC',supplierKitId:supplierKit.id,price:12000,stockStatus:'AVAILABLE',stockQuantity:4,leadTimeDays:4,validUntil:NOW+86400000,capturedAt:NOW});
    const sizing=SolarSizing.calculateSizing({monthlyConsumptions:Array(12).fill(850),connectionType:'BIPHASIC',hsp:4.8,performanceRatio:.8,modulePowerWp:625});
    const kits=kitService.listKits();
    const matching=Matching.matchKits({requiredDcPowerWp:sizing.requiredDcPowerWp,installedDcPowerWp:sizing.installedDcPowerWp,modulePowerWp:sizing.modulePowerWp,moduleCount:sizing.moduleCount,connectionType:sizing.connectionType,voltage:220},kits,{logger:silentLogger});
    const procurement=run(matching.matches,kits,{freightQuotes:[freight(supplier.id,supplierKit.id)]});
    assert.equal(matching.matches.length,1);
    assert.equal(procurement.bestOption.supplierKitOfferId,'O-DEV-PROC');
    assert.equal(procurement.bestOption.landedCost,12500);
  }finally{db.close();}
});
