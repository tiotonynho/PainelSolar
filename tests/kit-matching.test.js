const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Engine=require('../kit-matching-engine');
const SolarSizingEngine=require('../solar-sizing-engine');
const {openDatabase}=require('../db');
const {createKitService}=require('../kit-service');
const {seedDevelopmentCatalog}=require('../catalog-seed');

const silentLogger={info(){},warn(){}};

function requirements(overrides={}){
  return {requiredDcPowerWp:8000,installedDcPowerWp:8125,modulePowerWp:625,moduleCount:13,connectionType:'BIPHASIC',voltage:220,...overrides};
}

function kit(id,options={}){
  const modulePowerWp=options.modulePowerWp||500;
  const quantity=options.quantity===undefined?16:options.quantity;
  const module={id:`${id}-MODULE`,category:'MODULE',manufacturer:'DEV',model:`${id} Module`,specifications:{powerWp:modulePowerWp}};
  const items=options.items===undefined?[{id:`${id}-ITEM`,kitId:id,productId:module.id,quantity,role:'MODULE',product:module}]:options.items;
  return {
    id,
    name:options.name||id,
    nominalPowerWp:options.nominalPowerWp===undefined?modulePowerWp*quantity:options.nominalPowerWp,
    phaseType:options.phaseType||'BIPHASIC',
    voltage:options.voltage===undefined?'220 V':options.voltage,
    active:options.active===undefined?true:options.active,
    items
  };
}

function hasReason(result,kitId,reason){
  const rejected=result.rejected.find(item=>item.kitId===kitId);
  assert.ok(rejected,`kit ${kitId} deveria estar rejeitado`);
  assert.ok(rejected.reasons.includes(reason),`${kitId} não possui ${reason}`);
}

test('matching aceita potência exata como EXACT',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-EXACT')],{logger:silentLogger});
  assert.equal(result.matches.length,1);
  assert.equal(result.matches[0].classification,'EXACT');
  assert.equal(result.matches[0].powerDeviationWp,0);
  assert.deepEqual(result.matches[0].reasons,['POWER_WITHIN_TARGET','CONNECTION_TYPE_MATCH','VOLTAGE_MATCH']);
});

test('matching aceita kit ligeiramente acima e classifica GOOD',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-ABOVE',{quantity:17})],{logger:silentLogger});
  assert.equal(result.matches[0].classification,'GOOD');
  assert.equal(result.matches[0].powerDeviationWp,500);
  assert.ok(result.matches[0].powerDeviationPercent>6);
});

test('matching aceita kit ligeiramente abaixo dentro da faixa',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-BELOW',{quantity:15})],{logger:silentLogger});
  assert.equal(result.matches[0].classification,'GOOD');
  assert.equal(result.matches[0].kitPowerWp,7500);
});

test('matching rejeita kit muito abaixo por POWER_TOO_LOW',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-LOW',{quantity:10})],{logger:silentLogger});
  assert.equal(result.matches.length,0);
  hasReason(result,'KIT-LOW','POWER_TOO_LOW');
});

test('matching rejeita kit muito acima por POWER_TOO_HIGH',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-HIGH',{quantity:25})],{logger:silentLogger});
  assert.equal(result.matches.length,0);
  hasReason(result,'KIT-HIGH','POWER_TOO_HIGH');
});

test('matching rejeita fase incompatível',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-MONO',{phaseType:'MONOPHASIC'})],{logger:silentLogger});
  hasReason(result,'KIT-MONO','CONNECTION_TYPE_MISMATCH');
});

test('matching rejeita tensão incompatível',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-380',{voltage:'380 V'})],{logger:silentLogger});
  hasReason(result,'KIT-380','VOLTAGE_MISMATCH');
});

test('matching rejeita tensão ausente com VOLTAGE_UNKNOWN',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-NO-VOLTAGE',{voltage:null})],{logger:silentLogger});
  hasReason(result,'KIT-NO-VOLTAGE','VOLTAGE_UNKNOWN');
});

test('kit FLEXIBLE atende conexão específica compatível',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-FLEX',{phaseType:'FLEXIBLE'})],{logger:silentLogger});
  assert.equal(result.matches[0].classification,'EXACT');
  assert.ok(result.matches[0].reasons.includes('CONNECTION_TYPE_FLEXIBLE'));
});

test('kit inativo é excluído antes do ranking',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-INACTIVE',{active:false})],{logger:silentLogger});
  hasReason(result,'KIT-INACTIVE','KIT_INACTIVE');
});

test('kit inválido é excluído por integridade',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-INVALID',{items:[]})],{logger:silentLogger});
  hasReason(result,'KIT-INVALID','KIT_INVALID');
});

test('matching registra divergência entre potência nominal e módulos calculados',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-DIVERGENT',{nominalPowerWp:7000})],{logger:silentLogger});
  assert.ok(result.matches[0].reasons.includes('NOMINAL_POWER_DIVERGENCE'));
  assert.ok(result.matches[0].validationWarnings.some(message=>message.includes('diverge')));
  assert.equal(result.matches[0].kitPowerWp,8000);
});

test('tolerâncias e pesos são configuráveis em um único ponto',()=>{
  const result=Engine.matchKits(requirements(),[kit('KIT-CONFIG',{quantity:17})],{
    logger:silentLogger,
    config:{maxPowerRatio:1.05,weights:{powerProximity:1,connectionCompatibility:0,voltageCompatibility:0}}
  });
  hasReason(result,'KIT-CONFIG','POWER_TOO_HIGH');
  const accepted=Engine.matchKits(requirements(),[kit('KIT-CONFIG-ACCEPTED',{quantity:17})],{
    logger:silentLogger,
    config:{maxPowerRatio:1.1,weights:{powerProximity:1,connectionCompatibility:0,voltageCompatibility:0}}
  });
  assert.equal(accepted.matches[0].technicalScore,93.75);
});

test('ranking usa score, desvio absoluto e ID determinístico',()=>{
  const result=Engine.matchKits(requirements(),[
    kit('KIT-RANK-ABOVE',{quantity:17}),
    kit('KIT-RANK-EXACT',{quantity:16}),
    kit('KIT-RANK-BELOW',{quantity:15})
  ],{logger:silentLogger});
  assert.deepEqual(result.matches.map(item=>item.kitId),['KIT-RANK-EXACT','KIT-RANK-ABOVE','KIT-RANK-BELOW']);
  const tie=Engine.matchKits(requirements(),[kit('KIT-TIE-B'),kit('KIT-TIE-A')],{logger:silentLogger});
  assert.deepEqual(tie.matches.map(item=>item.kitId),['KIT-TIE-A','KIT-TIE-B']);
});

test('matching valida requisitos e emite eventos de observabilidade',()=>{
  const events=[];
  const logger={info:event=>events.push(event.event),warn:event=>events.push(event.event)};
  const result=Engine.matchKits(requirements(),[kit('KIT-LOW',{quantity:10})],{logger});
  assert.equal(result.matches.length,0);
  assert.deepEqual(events,['MATCH_STARTED','MATCH_COMPLETED','NO_COMPATIBLE_KITS']);
  assert.throws(()=>Engine.matchKits({...requirements(),requiredDcPowerWp:NaN},[],{logger}),error=>error.code==='MATCHING_VALIDATION');
  assert.equal(events.at(-1),'INVALID_REQUIREMENTS');
});

test('matching não acessa preço nem fornecedor',()=>{
  const candidate=kit('KIT-NO-COMMERCIAL');
  Object.defineProperty(candidate,'supplierKits',{get(){throw new Error('supplierKits não deve ser acessado');}});
  const result=Engine.matchKits(requirements(),[candidate],{logger:silentLogger});
  assert.equal(result.matches[0].kitId,'KIT-NO-COMMERCIAL');
});

test('integra SolarSizingEngine com kits DEV hidratados pelo Kit Domain',()=>{
  const dataDir=path.join(__dirname,'tmp','matching-'+crypto.randomUUID());
  fs.mkdirSync(dataDir,{recursive:true});
  const db=openDatabase(dataDir);
  try{
    seedDevelopmentCatalog(db);
    const kitService=createKitService(db);
    const sizing=SolarSizingEngine.calculateSizing({
      monthlyConsumptions:Array(12).fill(850),
      connectionType:'BIPHASIC',
      hsp:4.8,
      performanceRatio:.8,
      modulePowerWp:625
    });
    const result=Engine.matchKits({
      requiredDcPowerWp:sizing.requiredDcPowerWp,
      installedDcPowerWp:sizing.installedDcPowerWp,
      modulePowerWp:sizing.modulePowerWp,
      moduleCount:sizing.moduleCount,
      connectionType:sizing.connectionType,
      voltage:220
    },kitService.listKitsForMatching(),{logger:silentLogger});
    assert.equal(result.matches.length,1);
    assert.equal(result.matches[0].kitName,'DEV Kit 8.125 kWp');
    assert.ok(result.matches[0].kitPowerWp>result.requirements.requiredDcPowerWp);
    const small=result.rejected.find(item=>item.kitName==='DEV Kit 4.88 kWp');
    assert.ok(small.reasons.includes('POWER_TOO_LOW'));
  }finally{db.close();}
});
