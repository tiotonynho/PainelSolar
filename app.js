const months=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const defaultMonthlyHsp=[5.18,5.61,5.09,5.19,4.82,4.66,4.98,5.70,5.38,5.33,4.94,5.13];
let activeMonthlyHsp=[...defaultMonthlyHsp];
let hspSourceLabel='Valor padrão/manual';
let hspLookupId=0;
const form=document.querySelector('#quoteForm');
const grid=document.querySelector('#consumptionGrid');
let currentStep=1;
let lastResult=null;
const defaultModuleArea=2.645;

months.forEach((month,index)=>{grid.insertAdjacentHTML('beforeend',`<label>${month}<input class="consumption" type="number" min="0" step="1" value="400" aria-label="Consumo ${month}"></label>`)});

const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
const number=(value,digits=2)=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
const field=name=>form.elements[name];
const values=()=>Object.fromEntries(new FormData(form));
const solarApi=window.SolarApi?.createClient?.({timeoutMs:20000});

function resetCityOptions(message='Escolha a UF primeiro'){
  const city=field('city');
  city.replaceChildren(new Option(message,''));
  city.value='';
  city.disabled=true;
}

function fillCities(uf,selected=''){
  const city=field('city');
  const cities=window.SOLAR_LOCALITIES?.municipalities?.[uf]||[];
  city.replaceChildren(new Option(cities.length?'Cidade':'Cidade indisponível',''));
  for(const item of cities)city.add(new Option(item.name,item.name));
  city.disabled=!cities.length;
  if(selected&&cities.some(item=>item.name===selected))city.value=selected;
}

function setHspStatus(message){
  const status=document.querySelector('#hspStatus');
  if(status)status.textContent=message;
}

async function updateSolarHsp(){
  if(!solarApi||!field('state').value||!field('city').value)return;
  const requestId=++hspLookupId;
  const params=new URLSearchParams({state:field('state').value,city:field('city').value});
  setHspStatus('Consultando HSP da região...');
  try{
    const data=await solarApi('solar/hsp?'+params.toString());
    if(requestId!==hspLookupId)return;
    const monthlyOrder=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    activeMonthlyHsp=monthlyOrder.map(month=>Number(data.monthly?.[month])||Number(data.hsp));
    hspSourceLabel=`${data.source}; ${data.range}`;
    field('hsp').value=Number(data.hsp).toFixed(4);
    setHspStatus(`HSP automático: ${number(Number(data.hsp),2)} h/dia em ${data.matchedCity}/${data.state}.`);
    updateDimensioningPreview();
  }catch(error){
    if(requestId!==hspLookupId)return;
    setHspStatus(error.code==='AUTH_REQUIRED'?'Entre para buscar o HSP automático.':'Não foi possível buscar o HSP. Ajuste manualmente.');
  }
}

function setupLocalities(){
  const state=field('state');
  const localities=window.SOLAR_LOCALITIES;
  if(!localities?.states?.length){resetCityOptions('Cidade');return;}
  const selectedState=state.value;
  const selectedCity=field('city').value;
  state.replaceChildren(new Option('UF',''));
  for(const item of localities.states)state.add(new Option(`${item.uf} - ${item.name}`,item.uf));
  state.value=selectedState;
  if(state.value)fillCities(state.value,selectedCity);
  else resetCityOptions();
  state.addEventListener('change',()=>{fillCities(state.value);setHspStatus('Escolha a cidade para atualizar o HSP.');});
  field('city').addEventListener('change',updateSolarHsp);
}

function showView(id){
  document.body.dataset.print=id==='contract'?'contract':'proposal';
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));
  document.querySelector(`#${id}`).classList.add('active-view');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  const titles={dashboard:'Visão geral',quote:'Novo orçamento',clients:'Clientes',settings:'Configurações',proposal:'Proposta gerada',contracts:'Contratos',contract:'Contrato'};
  document.querySelector('#pageTitle').textContent=({team:'Equipe',account:'Minha conta'})[id]||titles[id]||'Pórtico Solar Energy';
  window.scrollTo({top:0,behavior:'smooth'});
}

function updateAverage(){
  const list=consumptionValues();
  const avg=monthlyAverage(list);
  const available=Number(field('connection').value)||0;
  document.querySelector('#averageConsumption').textContent=`${number(avg,0)} kWh`;
  document.querySelector('#compensableConsumption').textContent=`${number(Math.max(avg-available,0),0)} kWh`;
}

function consumptionValues(){
  return [...document.querySelectorAll('.consumption')].map(i=>Number(i.value)||0);
}

function monthlyAverage(list){
  return list.reduce((a,b)=>a+b,0)/12;
}

function dimensioningEstimate(data=values(),consumption=consumptionValues()){
  const average=monthlyAverage(consumption);
  const availability=Number(data.connection)||0;
  const targetMonthly=Math.max(average-availability,0);
  const hsp=Math.max(Number(data.hsp)||0,0);
  const performance=Math.max(Number(data.performance)||0,0);
  const modulePower=Math.max(Number(data.modulePower)||0,0);
  const requiredKwp=hsp&&performance?targetMonthly/(hsp*30.4*performance):0;
  const modules=modulePower?Math.max(1,Math.ceil(requiredKwp*1000/modulePower)):0;
  const installedKwp=modules*modulePower/1000;
  const referenceHsp=activeMonthlyHsp.reduce((a,b)=>a+b,0)/12;
  const generation=activeMonthlyHsp.map(h=>h/referenceHsp*hsp*30.4*performance*installedKwp);
  const annualGeneration=generation.reduce((a,b)=>a+b,0);
  return {consumption,average,targetMonthly,hsp,performance,modulePower,requiredKwp,modules,installedKwp,generation,annualGeneration};
}

function updateDimensioningPreview(){
  const estimate=dimensioningEstimate();
  const fields={
    moduleCountPreview:String(estimate.modules),
    installedPowerPreview:`${number(estimate.installedKwp)} kWp`,
    monthlyGenerationPreview:`${number(estimate.annualGeneration/12,0)} kWh`,
    annualGenerationPreview:`${number(estimate.annualGeneration,0)} kWh`
  };
  for(const [id,text] of Object.entries(fields)){
    const item=document.querySelector(`#${id}`);
    if(item)item.textContent=text;
  }
}

function percentageRate(data,name){
  return Number(data[name]||0)/100;
}

function investmentBreakdown(){
  const data=values();
  const kitCost=Number(data.kitCost)||0;
  const storageCost=data.systemType==='hybrid'?(Number(data.batteryCost)||0):0;
  const marginCost=kitCost*percentageRate(data,'margin');
  const installationCost=kitCost*percentageRate(data,'installationRate');
  const engineeringCost=kitCost*percentageRate(data,'engineeringRate');
  const taxCost=kitCost*percentageRate(data,'taxRate');
  const total=kitCost+marginCost+installationCost+engineeringCost+taxCost+storageCost;
  return {kitCost,storageCost,marginCost,installationCost,engineeringCost,taxCost,total};
}

function updateInvestmentPreview(){
  const breakdown=investmentBreakdown();
  const amounts={marginAmount:breakdown.marginCost,installationAmount:breakdown.installationCost,engineeringAmount:breakdown.engineeringCost,taxAmount:breakdown.taxCost};
  for(const [id,value] of Object.entries(amounts)){
    const item=document.querySelector(`#${id}`);
    if(item)item.textContent=money(value);
  }
  const preview=document.querySelector('#totalInvestmentPreview');
  if(preview)preview.textContent=money(breakdown.total);
}

function setStep(step){
  currentStep=step;
  document.querySelectorAll('.step-panel').forEach(p=>p.classList.toggle('active',Number(p.dataset.step)===step));
  document.querySelectorAll('.step').forEach((s,i)=>s.classList.toggle('active',i<step));
  document.querySelector('#prevStep').classList.toggle('hidden',step===1);
  document.querySelector('#nextStep').textContent=step===3?'Gerar proposta →':'Continuar →';
}

function calculate(){
  const d=values();
  const dimensioning=dimensioningEstimate(d);
  const {consumption,average,targetMonthly,modules,installedKwp,generation,annualGeneration}=dimensioning;
  const tariff=Number(d.tariff);
  const annualSavings=Math.min(annualGeneration,targetMonthly*12)*tariff;
  const kitCost=Number(d.kitCost);
  const hybrid=d.systemType==='hybrid';
  const storageCost=hybrid?Number(d.batteryCost):0;
  const storageCapacity=hybrid?Number(d.batteryCapacity)*Number(d.batteryQuantity):0;
  const usableCapacity=storageCapacity*Number(d.batteryDod||0)/100;
  const autonomy=hybrid?usableCapacity/Number(d.backupLoad):0;
  const marginCost=kitCost*percentageRate(d,'margin');
  const installationCost=kitCost*percentageRate(d,'installationRate');
  const engineeringCost=kitCost*percentageRate(d,'engineeringRate');
  const taxCost=kitCost*percentageRate(d,'taxRate');
  const investment=kitCost+marginCost+installationCost+engineeringCost+taxCost+storageCost;
  const payback=investment/annualSavings;
  return {...d,hybrid,hspSource:hspSourceLabel,solarProfile:[...activeMonthlyHsp],storageCost,storageCapacity,usableCapacity,autonomy,consumption,average,targetMonthly,modules,installedKwp,generation,annualGeneration,annualSavings,investment,payback,area:modules*defaultModuleArea};
}

function buildProposal(r){
  const date=new Intl.DateTimeFormat('pt-BR',{dateStyle:'long'}).format(new Date());
  const connection=field('connection').selectedOptions[0].textContent;
  document.querySelector('#pDate').textContent=date;
  document.querySelector('#pClientCover').textContent=r.clientName;
  document.querySelector('#pPowerCover').textContent=`${number(r.installedKwp)} kWp`;
  document.querySelector('#pSavingsCover').textContent=money(r.annualSavings);
  document.querySelector('#pClient').textContent=r.clientName;
  document.querySelector('#pAddress').textContent=`${r.address}, ${r.city}/${r.state}`;
  document.querySelector('#pInstallation').textContent=r.installation||'Não informada';
  document.querySelector('#pConnection').textContent=`Ligação ${connection.toLowerCase()}`;
  document.querySelector('#pPower').textContent=`${number(r.installedKwp)} kWp`;
  document.querySelector('#pModules').textContent=`${r.modules} × ${r.modulePower} W`;
  document.querySelector('#pGeneration').textContent=`${number(r.annualGeneration,0)} kWh`;
  document.querySelector('#pArea').textContent=`${number(r.area)} m²`;
  document.querySelector('#pMonthlyAverage').textContent=`${number(r.annualGeneration/12,0)} kWh/mês`;
  document.querySelector('#pInvestment').textContent=money(r.investment);
  document.querySelector('#pPayback').textContent=Number.isFinite(r.payback)?`${number(r.payback)} anos`:'Não aplicável';
  document.querySelector('#pAnnualSavings').textContent=money(r.annualSavings);
  document.querySelector('#pMonthlySavings').textContent=money(r.annualSavings/12);
  const max=Math.max(...r.generation);
  document.querySelector('#generationChart').innerHTML=r.generation.map((v,i)=>`<div class="bar-wrap" title="${months[i]}: ${number(v,0)} kWh"><div class="bar" style="height:${v/max*92}%"></div><span class="bar-label">${months[i]}</span></div>`).join('');
  renderEquipment(r);
  window.dispatchEvent(new CustomEvent('proposalbuilt',{detail:r}));
}

function renderEquipment(r){
  const type=r.hybrid?'Sistema híbrido com baterias':'Sistema conectado à rede';
  document.querySelector('#pSystemDescription').textContent=type+(r.hybrid?' • Armazenamento e alimentação de cargas essenciais, conforme projeto de backup.':' • Geração solar para compensação do consumo de energia.');
  let badge=document.querySelector('#pSystemBadge');
  if(!badge){badge=document.createElement('div');badge.id='pSystemBadge';badge.className='system-badge';document.querySelector('.cover-copy').prepend(badge);}
  badge.textContent=type;
  const moduleLabel=[r.moduleBrand,r.moduleModel].filter(Boolean).join(' ')||'Marca e modelo a definir';
  const inverterLabel=[r.inverterBrand,r.inverterModel].filter(Boolean).join(' ')||'Marca e modelo a definir';
  const cards=[
    ['MÓDULOS FOTOVOLTAICOS',moduleLabel,`${r.modules} unidades · ${r.modulePower} W por módulo · ${number(r.installedKwp)} kWp`],
    [r.hybrid?'INVERSOR HÍBRIDO':r.inverterType==='micro'?'MICROINVERSOR':'INVERSOR STRING',inverterLabel,`${r.inverterQuantity} unidades · ${number(Number(r.inverterPower))} kW por inversor`]
  ];
  if(r.hybrid)cards.push(['BATERIAS',`${r.batteryBrand} ${r.batteryModel}`,`${r.batteryQuantity} unidades · ${number(r.storageCapacity)} kWh nominais`]);
  const container=document.querySelector('#pEquipmentCards');
  container.replaceChildren(...cards.map(([label,title,detail])=>{
    const card=document.createElement('article');card.className='equipment-card';
    for(const [tag,text] of [['small',label],['h3',title],['p',detail]]){const el=document.createElement(tag);el.textContent=text;card.append(el);}
    return card;
  }));
  const storage=document.querySelector('#pStorage');storage.hidden=!r.hybrid;
  storage.textContent=r.hybrid?`Energia utilizável: ${number(r.usableCapacity)} kWh • Autonomia teórica: ${number(r.autonomy)} h com carga média de ${number(Number(r.backupLoad))} kW. Descarga considerada: ${r.batteryDod}%. Perdas, reserva e picos de carga podem reduzir a autonomia. Backup depende de circuito dedicado e validação técnica.`:'';
  document.querySelector('#pAssumptions').textContent=`HSP: ${number(Number(r.hsp))} h/dia · Fonte HSP: ${r.hspSource}. Performance ratio: ${number(Number(r.performance)*100,0)}% · Orientação: ${r.orientation}. Área estimada por referência técnica de ${number(defaultModuleArea,3)} m² por módulo, sem corredores. Economia limitada ao consumo compensável informado, com tarifa de ${money(Number(r.tariff))}/kWh; não inclui reajustes, degradação ou custos de manutenção. O armazenamento não acrescenta geração nem economia à estimativa. Custo adicional de armazenamento e backup: ${money(r.storageCost)}.`;
  const items=[`${r.modules} módulos ${moduleLabel}`,`${r.inverterQuantity} × ${inverterLabel}`,'Projeto de engenharia e homologação','Estrutura de fixação e instalação','Proteções elétricas e conectores'];
  if(r.hybrid)items.push(`${r.batteryQuantity} baterias ${r.batteryBrand} ${r.batteryModel} e instalação de backup`);
  document.querySelector('#pEquipment').replaceChildren(...items.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
}

function syncSystem(){
  const hybrid=field('systemType').value==='hybrid';
  const section=document.querySelector('#hybridFields');section.hidden=!hybrid;section.disabled=!hybrid;
  [...field('inverterType').options].forEach(option=>option.disabled=hybrid?option.value!=='hybrid':option.value==='hybrid');
  if(hybrid)field('inverterType').value='hybrid';
  else if(field('inverterType').value==='hybrid')field('inverterType').value='string';
}
field('systemType').addEventListener('change',syncSystem);
setupLocalities();
syncSystem();
for(const name of ['tariff','hsp','performance','kitCost','margin','installationRate','engineeringRate','taxRate','energyInflation']){
  field(name).required=true;
  field(name).min=['hsp','performance'].includes(name)?'0.01':'0';
}
field('performance').max='1';
field('hsp').step='any';
field('installationRate').step='any';
field('hsp').addEventListener('input',()=>{hspSourceLabel='Valor editado manualmente';setHspStatus('HSP editado manualmente. A curva mensal da região permanece como referência.');});
form.addEventListener('submit',event=>event.preventDefault());
form.addEventListener('input',()=>{updateInvestmentPreview();updateDimensioningPreview();});
form.addEventListener('change',()=>{updateInvestmentPreview();updateDimensioningPreview();});

function validateStep(step){
  const controls=document.querySelectorAll(`[data-step="${step}"] input,[data-step="${step}"] select`);
  for(const input of controls){
    if(input.type==='text')input.value=input.value.trim();
    if(!input.checkValidity()){input.reportValidity();return false;}
  }
  return true;
}

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
document.querySelectorAll('#newQuoteTop,#heroNew,#panelNew,.openQuote').forEach(btn=>btn.addEventListener('click',()=>showView('quote')));
document.querySelectorAll('.consumption').forEach(i=>i.addEventListener('input',updateAverage));
field('connection').addEventListener('change',updateAverage);
document.querySelector('#prevStep').addEventListener('click',()=>setStep(Math.max(1,currentStep-1)));
document.querySelector('#nextStep').addEventListener('click',()=>{
  if(!validateStep(currentStep))return;
  if(currentStep<3){setStep(currentStep+1);return;}
  lastResult=calculate(); buildProposal(lastResult); showView('proposal');
});
document.querySelector('#editQuote').addEventListener('click',()=>{showView('quote');setStep(3)});
document.querySelector('#printProposal').addEventListener('click',()=>window.print());
updateAverage();
updateInvestmentPreview();
updateDimensioningPreview();
const preview=new URLSearchParams(location.search).get('preview');
if(preview==='quote')showView('quote');
if(preview==='proposal'){
  lastResult=calculate();
  buildProposal(lastResult);
  showView('proposal');
}
