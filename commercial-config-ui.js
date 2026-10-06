(()=>{
  const form=document.querySelector('#commercialConfigForm');
  if(!form||!window.SolarApi)return;
  const api=SolarApi.createClient(),$=selector=>document.querySelector(selector);
  const message=text=>$('#commercialConfigMessage').textContent=text||'';
  const percentToRate=value=>value===''||value===null||value===undefined?null:Number(value)/100;
  const percent=value=>value===null||value===undefined?'':(Number(value)*100).toFixed(2).replace(/\.00$/,'');
  function formData(){
    const data=Object.fromEntries(new FormData(form));
    return {
      ...data,
      defaultInstallationCost:Number(data.defaultInstallationCost||0),defaultEngineeringCost:Number(data.defaultEngineeringCost||0),
      defaultMarkupRate:percentToRate(data.defaultMarkupRate),defaultTargetMarginRate:percentToRate(data.defaultTargetMarginRate),
      defaultCommissionRate:Number(data.defaultCommissionRate||0)/100,defaultTaxRate:Number(data.defaultTaxRate||0)/100,
      minimumMarginRate:percentToRate(data.minimumMarginRate),defaultFreightRequired:form.elements.defaultFreightRequired.checked
    };
  }
  function render(configs){
    const target=$('#commercialConfigList');target.replaceChildren();
    if(!configs.length){target.append(Object.assign(document.createElement('p'),{textContent:'Nenhuma versão criada. O modo LEGACY continua disponível sem configuração.'}));return;}
    for(const config of configs){
      const row=document.createElement('article');row.className='team-row';
      const info=document.createElement('div');
      const title=document.createElement('strong');title.textContent=`v${config.version} · ${config.name}${config.active?' · ATIVA':''}`;
      const details=document.createElement('small');details.textContent=`${config.pricingMode} · instalação ${money(config.defaultInstallationCost)} · engenharia ${money(config.defaultEngineeringCost)} · markup ${percent(config.defaultMarkupRate)}% · margem alvo ${percent(config.defaultTargetMarginRate)}%`;
      info.append(title,details);row.append(info);
      if(!config.active){const button=document.createElement('button');button.className='ghost';button.textContent='Ativar versão';button.onclick=async()=>{button.disabled=true;try{await api('admin/commercial-config/'+config.id+'/activate',{method:'PATCH'});await load();message('Versão ativada. Propostas existentes não foram recalculadas.');}catch(error){message(error.message);button.disabled=false;}};row.append(button);}
      target.append(row);
    }
  }
  async function load(){
    try{render(await api('admin/commercial-config'));}catch(error){message(error.message);}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('button');button.disabled=true;
    try{await api('admin/commercial-config',{method:'POST',body:JSON.stringify(formData())});form.reset();form.elements.defaultInstallationCost.value='0';form.elements.defaultEngineeringCost.value='0';form.elements.defaultCommissionRate.value='0';form.elements.defaultTaxRate.value='0';await load();message('Nova versão criada. Ative-a explicitamente quando estiver validada.');}
    catch(error){message(error.message);}finally{button.disabled=false;}
  });
  const settingsNav=document.querySelector('[data-view="settings"]');settingsNav?.addEventListener('click',load);
  window.addEventListener('authchanged',event=>{if(event.detail?.role==='admin')load();});
  function money(value){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);}
})();
