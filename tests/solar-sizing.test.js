const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Engine=require('../solar-sizing-engine');

const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/solar-sizing/fixtures.json'),'utf8'));
const LEGACY_MONTHLY_HSP=[5.18,5.61,5.09,5.19,4.82,4.66,4.98,5.70,5.38,5.33,4.94,5.13];

function legacySizing(input){
  const availability={MONOPHASIC:30,BIPHASIC:50,TRIPHASIC:100};
  const average=input.monthlyConsumptions.reduce((sum,value)=>sum+value,0)/12;
  const targetMonthly=Math.max(average-availability[input.connectionType],0);
  const requiredKwp=targetMonthly/(input.hsp*30.4*input.performanceRatio);
  const modules=Math.max(1,Math.ceil(requiredKwp*1000/input.modulePowerWp));
  const installedKwp=modules*input.modulePowerWp/1000;
  const profile=LEGACY_MONTHLY_HSP;
  const referenceHsp=profile.reduce((sum,value)=>sum+value,0)/12;
  const generation=profile.map(h=>h/referenceHsp*input.hsp*30.4*input.performanceRatio*installedKwp);
  return {averageConsumptionKwh:average,availabilityConsumptionKwh:availability[input.connectionType],compensableConsumptionKwh:targetMonthly,requiredDcPowerWp:requiredKwp*1000,moduleCount:modules,installedDcPowerWp:installedKwp*1000,monthlyGenerationKwh:generation,estimatedAnnualGenerationKwh:generation.reduce((sum,value)=>sum+value,0)};
}

function closeTo(actual,expected){assert.ok(Math.abs(actual-expected)<=1e-9,`expected ${expected}, got ${actual}`);}

test('SolarSizingEngine mantém equivalência com a implementação legada em 10 cenários',()=>{
  for(const fixture of fixtures){
    const actual=Engine.calculateSizing(fixture.input);
    const legacy=legacySizing(fixture.input);
    for(const key of ['averageConsumptionKwh','availabilityConsumptionKwh','compensableConsumptionKwh','requiredDcPowerWp','installedDcPowerWp','estimatedAnnualGenerationKwh']){
      closeTo(actual[key],legacy[key]);
      closeTo(actual[key],fixture.expected[key]);
    }
    assert.equal(actual.moduleCount,legacy.moduleCount);
    assert.equal(actual.moduleCount,fixture.expected.moduleCount);
    assert.equal(actual.monthlyGenerationKwh.length,12);
    actual.monthlyGenerationKwh.forEach((value,index)=>closeTo(value,legacy.monthlyGenerationKwh[index]));
  }
});

test('histórico parcial e entrada escalar não inventam consumo ausente',()=>{
  const partial=Engine.calculateSizing({monthlyConsumptions:[100,200,300],connectionType:'bifásico',hsp:5,performanceRatio:.75,modulePowerWp:500});
  assert.equal(partial.monthlyConsumptions.length,3);
  assert.equal(partial.averageConsumptionKwh,200);
  assert.equal(partial.availabilityConsumptionKwh,50);
  const scalar=Engine.calculateSizing({monthlyConsumptionKwh:850,connectionType:'50',hsp:4.8,performanceRatio:.8,modulePowerWp:625});
  assert.deepEqual(scalar.monthlyConsumptions,[850]);
  assert.equal(scalar.averageConsumptionKwh,850);
});

test('unidades, potência instalada e perfil mensal são explícitos',()=>{
  const result=Engine.calculateSizing({monthlyConsumptions:Array(12).fill(850),connectionType:'BIPHASIC',hsp:4.8,performanceRatio:.8,modulePowerWp:625});
  assert.equal(result.moduleCount,11);
  assert.equal(result.installedDcPowerWp,6875);
  assert.equal(result.requiredDcPowerWp>0,true);
  assert.equal(result.monthlyGenerationKwh.length,12);
  assert.equal(result.estimatedMonthlyGenerationKwh,result.estimatedAnnualGenerationKwh/12);
  const custom=Engine.calculateSizing({monthlyConsumptions:Array(12).fill(500),connectionType:'TRIPHASIC',hsp:4,performanceRatio:.8,modulePowerWp:500,monthlyHspProfile:Array(12).fill(4)});
  assert.equal(custom.referenceHsp,4);
  assert.equal(custom.monthlyGenerationKwh.every(value=>value===custom.monthlyGenerationKwh[0]),true);
});

test('validação rejeita valores inválidos e não produz NaN',()=>{
  const valid={monthlyConsumptions:[400],connectionType:'BIPHASIC',hsp:5,performanceRatio:.8,modulePowerWp:625};
  for(const input of [
    {...valid,monthlyConsumptions:[-1]},
    {...valid,hsp:0},
    {...valid,performanceRatio:0},
    {...valid,performanceRatio:1.1},
    {...valid,modulePowerWp:0},
    {...valid,hsp:NaN},
    {...valid,monthlyConsumptions:['400']},
    {...valid,monthlyConsumptions:[]},
    {...valid,monthlyHspProfile:[4,4]}
  ]){
    assert.throws(()=>Engine.calculateSizing(input),error=>error.code==='SIZING_VALIDATION');
  }
  const validation=Engine.validateSizingInput({...valid,hsp:Infinity});
  assert.equal(validation.valid,false);
  assert.equal(validation.errors.length>0,true);
});

test('arredondamento preserva mínimo histórico de um módulo',()=>{
  const result=Engine.calculateSizing({monthlyConsumptions:Array(12).fill(0),connectionType:'MONOPHASIC',hsp:1,performanceRatio:.01,modulePowerWp:1000});
  assert.equal(result.requiredDcPowerWp,0);
  assert.equal(result.moduleCount,1);
  assert.equal(result.installedDcPowerWp,1000);
});
