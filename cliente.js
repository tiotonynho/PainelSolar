(()=>{
  const token=location.hash.slice(1),$=s=>document.querySelector(s);
  const COMPANY={name:'Pórtico Solar',whatsapp:'5535984092508'};
  const months=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const api=SolarApi.createClient();
  let record;
  const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
  const number=(n,digits=2)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:digits}).format(Number(n)||0);
  const set=(selector,value)=>{const node=$(selector);if(node)node.textContent=value??'';};
  const longDate=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'long'}).format(new Date(value)):'';
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};

  function request(action='',data){
    return api('public/'+encodeURIComponent(token)+action,{method:data?'POST':'GET',body:data?JSON.stringify(data):undefined});
  }
  function whatsappLink(p){
    const first=(p.clientName||'').split(' ')[0];
    const text=`Olá! Sou ${first||'cliente'} e estou vendo a proposta ${record.id} da ${COMPANY.name}. Tenho uma dúvida:`;
    return 'https://wa.me/'+COMPANY.whatsapp+'?text='+encodeURIComponent(text);
  }

  function renderProposal(p){
    const services=p.quoteType==='services';
    document.querySelectorAll('.system-only').forEach(node=>node.hidden=services);
    set('#cNumber',record.id);
    set('#cSystemBadge',services?'Serviços solares':p.hybrid?'Sistema híbrido com baterias':'Sistema conectado à rede');
    $('#cCoverTitle').innerHTML=services?'Serviços solares.<br>Execução com clareza.':'Energia limpa.<br>Economia de verdade.';
    set('#cClientCover',p.clientName);
    set('#cCoverFirstLabel',services?'Tipo de proposta':'Potência do sistema');
    set('#cCoverFirst',services?'Serviços':number(p.installedKwp)+' kWp');
    set('#cCoverSecondLabel',services?'Valor dos serviços':'Economia no 1º ano');
    set('#cCoverSecond',money(services?p.customerPrice:p.annualSavings));
    set('#cDate',longDate(p.issuedAt));
    set('#cProjectHeading',services?'Seus serviços':'Seu projeto solar');
    set('#cProjectLead',services?'Serviços orçados para a sua instalação.':'Dimensionamento desenvolvido a partir do seu consumo e do potencial solar da região.');
    set('#cClient',p.clientName);
    set('#cAddress',[p.address,[p.city,p.state].filter(Boolean).join('/')].filter(Boolean).join(', '));
    set('#cInstallation',p.installation||'Não informada');
    set('#cConnection',p.connection?'Ligação '+p.connection.toLowerCase():'');

    if(!services){
      set('#cPower',number(p.installedKwp)+' kWp');
      set('#cModules',p.modules&&p.modulePower?`${number(p.modules,0)} × ${number(p.modulePower,0)} W`:'—');
      set('#cGeneration',number(p.annualGeneration,0)+' kWh');
      set('#cArea',p.area?number(p.area)+' m²':'—');
      set('#cMonthlyAverage',number((p.annualGeneration||0)/12,0)+' kWh/mês');
      const generation=p.generation||[],max=Math.max(...generation,1);
      $('#cChartCard').hidden=generation.length!==12;
      $('#cChart').replaceChildren(...generation.map((value,index)=>{
        const wrap=el('div',undefined,'bar-wrap');wrap.title=`${months[index]}: ${number(value,0)} kWh`;
        const bar=el('div',undefined,'bar');bar.style.height=(value/max*92)+'%';
        wrap.append(bar,el('span',months[index],'bar-label'));return wrap;
      }));
      renderEquipment(p);
      set('#cPayback',p.payback?number(p.payback,1)+' anos':'Não aplicável');
      set('#cAnnualSavings',money(p.annualSavings));
      set('#cMonthlySavings',money((p.annualSavings||0)/12));
      set('#cAssumptions',`Valores estimados a partir do consumo informado e da média histórica de radiação solar da região${p.tariff?`, com tarifa de ${money(p.tariff)}/kWh`:''}. A economia real pode variar conforme o clima, reajustes de tarifa e regras da distribuidora.`);
    }
    set('#cFinanceHeading',services?'Investimento nos serviços':'O investimento que se paga');
    set('#cFinanceLead',services?'Valor total dos serviços orçados.':'A economia produzida pelo sistema recupera o investimento e continua gerando valor.');
    set('#cInvestment',money(p.customerPrice));
    set('#cInvestmentNote',services?'Serviços orçados':'Equipamentos, projeto e instalação');
    const list=p.additionalServices||[];
    $('#cServicesBlock').hidden=!list.length;
    $('#cServices').replaceChildren(...list.map(item=>el('li',`${item.label}: ${number(item.quantity,0)} × ${money(item.unitValue)} = ${money(item.total)}`)));
    set('#cServiceNotes',p.serviceNotes?'Observações: '+p.serviceNotes:'');
    $('#customerProposal').hidden=false;
  }

  function renderEquipment(p){
    const moduleLabel=[p.moduleBrand,p.moduleModel].filter(Boolean).join(' ')||'Marca e modelo a definir';
    const inverterLabel=[p.inverterBrand,p.inverterModel].filter(Boolean).join(' ')||'Marca e modelo a definir';
    set('#cSystemDescription',p.hybrid?'Sistema híbrido com baterias • Armazenamento e alimentação de cargas essenciais, conforme projeto de backup.':'Sistema conectado à rede • Geração solar para compensação do seu consumo de energia.');
    const cards=[
      ['MÓDULOS FOTOVOLTAICOS',moduleLabel,`${number(p.modules,0)} unidades · ${number(p.modulePower,0)} W por módulo · ${number(p.installedKwp)} kWp`],
      [p.hybrid?'INVERSOR HÍBRIDO':p.inverterType==='micro'?'MICROINVERSOR':'INVERSOR',inverterLabel,`${number(p.inverterQuantity,0)} unidade(s) · ${number(p.inverterPower)} kW por inversor`]
    ];
    if(p.battery)cards.push(['BATERIAS',[p.battery.brand,p.battery.model].filter(Boolean).join(' '),`${number(p.battery.quantity,0)} unidade(s) · ${number(p.battery.capacity)} kWh nominais`]);
    $('#cEquipmentCards').replaceChildren(...cards.map(([label,title,detail])=>{const card=el('article',undefined,'equipment-card');card.append(el('small',label),el('h3',title),el('p',detail));return card;}));
    const storage=$('#cStorage');storage.hidden=!p.battery;
    storage.textContent=p.battery?`Energia utilizável: ${number(p.battery.usable)} kWh • Autonomia teórica: ${number(p.battery.autonomy)} h com carga média de ${number(p.battery.backupLoad)} kW. Perdas e picos de carga podem reduzir a autonomia.`:'';
    const items=[`${number(p.modules,0)} módulos ${moduleLabel}`,`${number(p.inverterQuantity,0)} × ${inverterLabel}`,'Projeto de engenharia e homologação','Estrutura de fixação e instalação','Proteções elétricas e conectores','Aplicativo de monitoramento em tempo real'];
    if(p.battery)items.push(`${number(p.battery.quantity,0)} baterias ${[p.battery.brand,p.battery.model].filter(Boolean).join(' ')} e instalação de backup`);
    (p.additionalServices||[]).forEach(item=>items.push(item.label));
    $('#cIncluded').replaceChildren(...items.map(text=>el('li',text)));
  }

  function renderDecision(){
    const p=record.proposal,status=record.status;
    const titles={pending:'Aceitar proposta',accepted:'Proposta aceita',prepared:'Assinar contrato',signed:'Contrato assinado'};
    const leads={
      pending:'Revise os valores acima. Ao aceitar, nossa equipe prepara o contrato e avisa você para a assinatura.',
      accepted:'Recebemos o seu aceite. Estamos preparando o contrato; você vai assiná-lo por este mesmo link.',
      prepared:'Leia o contrato abaixo com atenção. Depois, confirme seus dados para assinar eletronicamente.',
      signed:'Tudo certo! Guarde o comprovante abaixo. Nossa equipe entrará em contato para agendar a instalação.'
    };
    const chips={pending:'Aguardando seu aceite',accepted:'Contrato em preparação',prepared:'Aguardando sua assinatura',signed:'Assinado'};
    set('#publicStatus',chips[status]||'');$('#publicStatus').dataset.status=status;
    set('#publicAction',titles[status]);set('#decisionLead',leads[status]);
    set('#decisionKicker',status==='signed'?'CONCLUÍDO':'PRÓXIMO PASSO');
    const validity=$('#validity');
    if(status==='pending'&&p.expiresAt){
      const hours=(p.expiresAt-Date.now())/3600000;
      validity.hidden=false;validity.classList.toggle('is-urgent',hours<24);
      validity.textContent='Válida até '+new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(p.expiresAt));
    }else validity.hidden=true;
    $('#publicContract').hidden=!record.contract;
    $('#publicContract').textContent=record.contract?.text||'';
    const open=['pending','prepared'].includes(status);
    $('#publicForm').hidden=!open;
    set('#publicConsent',status==='pending'?'Li e aceito os equipamentos, valores e condições desta proposta.':'Li integralmente e concordo com o contrato apresentado. Desejo assiná-lo eletronicamente com os dados informados.');
    set('#publicSubmit',status==='pending'?'Aceitar proposta':'Assinar contrato');
    $('#publicPrint').hidden=status!=='signed';
    if(record.signature)set('#publicMessage','Assinado por '+record.signature.name+' em '+new Date(record.signature.date).toLocaleString('pt-BR')+'. Identificador SHA-256 do contrato: '+record.signature.hash);
    set('#consultantName',p.consultant?`${p.consultant} · ${COMPANY.name}`:`Fale com a equipe ${COMPANY.name}`);
    const wa=whatsappLink(p);$('#consultantWhatsapp').href=wa;$('#actionBarWhatsapp').href=wa;
    $('#actionBarMain').hidden=!open;set('#actionBarMain',status==='pending'?'Aceitar proposta':'Assinar contrato');
    $('#actionBarMain').href=status==='prepared'?'#publicContract':'#decision';
    $('#actionBar').hidden=false;$('#decision').hidden=false;
  }

  async function load(){
    record=await request();
    $('#publicError').hidden=true;
    renderProposal(record.proposal);renderDecision();
  }

  const documentInput=$('#publicForm').elements.document;
  documentInput.addEventListener('input',()=>{
    const digits=documentInput.value.replace(/\D/g,'').slice(0,14);
    documentInput.value=digits.length<=11
      ?digits.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')
      :digits.replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/,'$1.$2.$3').replace(/\.(\d{3})(\d)/,'.$1/$2').replace(/(\d{4})(\d)/,'$1-$2');
  });

  $('#publicForm').onsubmit=async event=>{
    event.preventDefault();const submittedForm=event.currentTarget;$('#publicSubmit').disabled=true;
    const message=$('#publicMessage');message.classList.remove('is-error');
    try{
      const data=Object.fromEntries(new FormData(submittedForm));data.confirmed=submittedForm.elements.confirmed.checked;data.hash=record.contract?.hash;
      await request(record.status==='pending'?'/accept':'/sign',data);
      message.textContent=record.status==='pending'?'Aceite registrado! Avisaremos quando o contrato estiver pronto para assinatura.':'Assinatura registrada com sucesso.';
      submittedForm.reset();await load();
      $('#decision').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){message.textContent=error.message;message.classList.add('is-error');}finally{$('#publicSubmit').disabled=false;}
  };
  $('#publicPrint').onclick=()=>window.print();
  load().catch(error=>{
    set('#publicStatus','Indisponível');
    const box=$('#publicError');box.hidden=false;
    box.textContent=error.message+' Se precisar, fale com a equipe '+COMPANY.name+' pelo WhatsApp (35) 98409-2508.';
  });
})();
