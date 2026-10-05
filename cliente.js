(()=>{
  const token=location.hash.slice(1),$=s=>document.querySelector(s);
  let record;
  const api=SolarApi.createClient();
  const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
  async function request(action='',data){
    return api('public/'+encodeURIComponent(token)+action,{method:data?'POST':'GET',body:data?JSON.stringify(data):undefined});
  }
  async function load(){
    record=await request();const p=record.proposal,target=$('#publicSummary');target.replaceChildren();
    const statuses={pending:'Proposta disponível para aceite',accepted:'Proposta aceita. Aguarde a preparação do contrato.',prepared:'Contrato disponível para revisão e assinatura',signed:'Assinatura do cliente registrada'};
    $('#publicStatus').textContent=statuses[record.status];
    for(const text of [record.id,p.clientName,p.address+', '+p.city+'/'+p.state,p.equipment,'Potência: '+p.installedKwp+' kWp','Geração estimada: '+Math.round(p.annualGeneration)+' kWh/ano','Investimento: '+money(p.investment),'Pagamento: 80% na assinatura do contrato e 20% após a instalação.']){
      const row=document.createElement('p');row.textContent=text;target.append(row);
    }
    if(p.services){
      const row=document.createElement('p');
      row.textContent='Serviços adicionais: '+p.services;
      target.insertBefore(row,target.children[4]||null);
    }
    if(p.quoteType==='services'){
      const start=p.services?5:4;
      target.children[start]?.remove();
      target.children[start]?.remove();
    }
    $('#publicContract').hidden=!record.contract;
    $('#publicContract').textContent=record.contract?.text||'';
    $('#publicForm').hidden=!['pending','prepared'].includes(record.status);
    $('#publicAction').textContent=record.status==='pending'?'Aceitar proposta':'Assinar contrato';
    $('#publicConsent').textContent=record.status==='pending'?'Li e aceito os equipamentos, valores e condições desta proposta.':'Li integralmente e concordo com o contrato apresentado. Desejo assiná-lo eletronicamente com os dados informados.';
    $('#publicSubmit').textContent=record.status==='pending'?'Aceitar proposta':'Assinar contrato';
    $('#publicPrint').hidden=record.status!=='signed';
    if(record.signature)$('#publicMessage').textContent='Assinado por '+record.signature.name+' em '+new Date(record.signature.date).toLocaleString('pt-BR')+'. Identificador SHA-256 do contrato: '+record.signature.hash;
  }
  $('#publicForm').onsubmit=async event=>{
    event.preventDefault();const submittedForm=event.currentTarget;$('#publicSubmit').disabled=true;
    try{
      const data=Object.fromEntries(new FormData(submittedForm));data.confirmed=submittedForm.elements.confirmed.checked;data.hash=record.contract?.hash;
      await request(record.status==='pending'?'/accept':'/sign',data);
      $('#publicMessage').textContent='Confirmação registrada com sucesso.';submittedForm.reset();await load();
    }catch(error){$('#publicMessage').textContent=error.message;}finally{$('#publicSubmit').disabled=false;}
  };
  $('#publicPrint').onclick=()=>window.print();
  load().catch(error=>$('#publicStatus').textContent=error.message);
})();
