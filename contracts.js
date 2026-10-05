(()=>{
  
  let records=[], current=null, pending=null;
  const $=selector=>document.querySelector(selector);
  const el=(tag,text,className)=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;};
  const uid=()=> 'PT-'+new Date().getFullYear()+'-'+crypto.randomUUID().slice(0,8).toUpperCase();
  const today=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,10);};
  const nav=el('button','▤ Contratos','nav-item');nav.dataset.view='contracts';
  nav.replaceChildren(el('span','▤'),document.createTextNode(' Contratos'));nav.setAttribute('aria-label','Contratos');
  nav.onclick=()=>{refresh();showView('contracts');};$('.sidebar nav').append(nav);
  const list=document.createElement('section');list.id='contracts';list.className='view';
  list.innerHTML='<div class="panel"><div class="panel-heading"><div><h2>Contratos</h2><p>Do aceite da proposta à preparação para assinatura.</p></div></div><p class="field-help">Registros salvos no servidor. Compartilhe o link para o cliente aceitar a proposta e assinar o contrato.</p><p id="contractStorageMessage" role="status"></p><button class="ghost" id="refreshContracts">Atualizar lista</button><div id="contractList"></div></div>';
  $('main').append(list);
  const editor=document.createElement('section');editor.id='contract';editor.className='view';
  editor.innerHTML=`<div class="contract-controls"><div class="proposal-actions"><button class="ghost" id="backContracts">← Contratos</button><button class="primary" id="printContract" disabled>Imprimir / Salvar PDF</button></div>
    <div class="panel"><span class="section-kicker">PROPOSTA ACEITA → CONTRATO</span><h2 id="contractTitle"></h2><p id="acceptanceSummary"></p>
    <p class="field-help">Modelo adaptado do contrato enviado. Confira as cláusulas e referências normativas do modelo antes de emitir. O aceite da proposta e a assinatura do contrato são etapas separadas.</p>
    <form id="contractForm"><div class="form-grid" id="contractFields"></div><button class="primary" type="submit">Preparar minuta</button></form>
    <div id="contractReview" hidden><label>Texto do contrato<textarea id="contractText" rows="22"></textarea></label><label class="check-label"><input type="checkbox" id="reviewConfirmed">Conferi os dados e o texto desta versão para emissão.</label><div class="contract-review-actions"><button class="ghost" id="printDraft" type="button">Imprimir minuta / Salvar PDF</button><button class="primary" id="saveContract">Publicar versão para assinatura</button></div></div>
    <p id="contractMessage" role="status"></p></div></div><article class="contract-document" id="contractDocument" hidden></article>`;
  $('main').append(editor);
  const approval=document.createElement('div');approval.className='panel acceptance-panel';
  approval.innerHTML='<h3>Aceite e assinatura por link</h3><p id="proposalApprovalStatus">Crie o link para o cliente revisar e aceitar esta proposta.</p><label class="check-label test-record-label"><input type="checkbox" id="testRecord">Registro de teste</label><button class="primary" id="shareProposal">Gerar link do cliente</button><p id="acceptanceMessage" role="status"></p><a id="customerLink" target="_blank" rel="noopener noreferrer" hidden></a>';
  $('.proposal-actions').after(approval);
  const api=SolarApi.createClient();
  const loginShortcut=el('button','Entrar na plataforma','ghost');loginShortcut.hidden=true;
  loginShortcut.onclick=()=>window.SolarAuth?.requireLogin();$('#acceptanceMessage').after(loginShortcut);
  const returnToProposal=el('button','Voltar à proposta','ghost');returnToProposal.hidden=true;
  returnToProposal.onclick=()=>showView('proposal');$('#refreshContracts').after(returnToProposal);
  async function refresh(){
    if(!window.SolarAuth?.user||window.SolarAuth.user.mustChangePassword)return;
    try{records=await api('records');$('#contractStorageMessage').textContent='';renderList();renderOverview();}
    catch(error){$('#contractStorageMessage').textContent=error.message;}
  }
  window.addEventListener('authchanged',refresh);
  $('#refreshContracts').onclick=refresh;
  const activeRecords=()=>records.filter(record=>record.status!=='archived');
  const recordClientKey=record=>record.proposal.document||record.proposal.clientName;
  const proposalScope=proposal=>proposal.quoteType==='services'?'Serviços':number(Number(proposal.installedKwp)||0)+' kWp';
  const canDeleteRecord=record=>!record.acceptance&&['pending','archived'].includes(record.status);
  function renderList(){
    const target=$('#contractList');target.replaceChildren();
    if(!records?.length){target.append(el('p','Nenhum contrato registrado. Gere uma proposta e registre o aceite do cliente.'));return;}
    const labels={pending:'Aguardando aceite',accepted:'Aceite recebido',prepared:'Aguardando assinatura',signed:'Assinado pelo cliente',archived:'Arquivada'};
    for(const record of [...records].reverse()){
      const row=el('div','','contract-row');
      const info=el('div');info.append(el('strong',record.proposal.clientName),el('small',record.id+' · '+money(record.proposal.investment)+(record.isTest?' · Teste':'')+(record.archivedAt?' · Arquivada em '+new Date(record.archivedAt).toLocaleDateString('pt-BR'):'')));
      const status=el('span',labels[record.status]||record.status,'status '+(record.status==='archived'?'draft':'sent'));
      const actions=el('div','','record-actions');
      if(record.status==='pending'){
        const link=el('button','Ver link','ghost');link.onclick=()=>showRecordLink(record,row);
        const archive=el('button','Arquivar','ghost');archive.onclick=()=>archiveRecord(record);
        const remove=el('button','Deletar','ghost danger');remove.onclick=()=>deleteRecord(record);
        actions.append(link,archive,remove);
      }else if(record.status==='archived'){
        const remove=el('button','Deletar','ghost danger');remove.onclick=()=>deleteRecord(record);
        actions.append(remove);
      }else{
        const button=el('button','Abrir contrato','ghost');button.onclick=()=>open(record.id);actions.append(button);
      }
      row.append(info,status,actions);target.append(row);
    }
  }
  async function archiveRecord(record){
    if(!confirm('Arquivar esta proposta? O link enviado ao cliente deixará de aceitar aceite.'))return;
    try{
      $('#contractStorageMessage').textContent='Arquivando proposta...';
      const next=await api('records/'+record.id+'/archive',{method:'PATCH'});
      records=records.map(item=>item.id===next.id?next:item);renderList();renderOverview();
      $('#contractStorageMessage').textContent='Proposta arquivada.';
    }catch(error){$('#contractStorageMessage').textContent=error.message;}
  }
  async function deleteRecord(record){
    if(!confirm('Deletar esta proposta? Esta ação remove o registro e o link do cliente.'))return;
    try{
      $('#contractStorageMessage').textContent='Deletando proposta...';
      await api('records/'+record.id,{method:'DELETE'});
      records=records.filter(item=>item.id!==record.id);renderList();renderOverview();
      $('#contractStorageMessage').textContent='Proposta deletada.';
    }catch(error){$('#contractStorageMessage').textContent=error.message;}
  }
  async function deleteClient(key,clientName){
    const related=records.filter(record=>recordClientKey(record)===key);
    if(!related.length)return;
    if(!related.every(canDeleteRecord)){
      $('#contractStorageMessage').textContent='Este cliente possui proposta aceita, contrato ou assinatura. O histórico não pode ser deletado.';
      return;
    }
    if(!confirm('Deletar o cliente '+clientName+' e '+related.length+' proposta(s) sem aceite?'))return;
    try{
      $('#contractStorageMessage').textContent='Deletando cliente...';
      for(const record of related)await api('records/'+record.id,{method:'DELETE'});
      const deletedIds=new Set(related.map(record=>record.id));
      records=records.filter(record=>!deletedIds.has(record.id));renderList();renderOverview();
      $('#contractStorageMessage').textContent='Cliente deletado.';
    }catch(error){$('#contractStorageMessage').textContent=error.message;await refresh();}
  }
  async function deleteTestRecords(){
    const total=records.filter(record=>record.isTest).length;
    if(!total){$('#contractStorageMessage').textContent='Não há registros de teste para excluir.';return;}
    if(prompt('Digite TESTE para excluir '+total+' registro(s) de teste, incluindo aceites e contratos.')!=='TESTE')return;
    try{
      $('#contractStorageMessage').textContent='Excluindo registros de teste...';
      const result=await api('records/test',{method:'DELETE'});
      records=records.filter(record=>!record.isTest);renderList();renderOverview();
      $('#contractStorageMessage').textContent=result.deleted+' registro(s) de teste excluído(s).';
    }catch(error){$('#contractStorageMessage').textContent=error.message;await refresh();}
  }
  function renderOverview(){
    const visible=activeRecords();
    const tbody=$('#recentQuotes');tbody.replaceChildren();
    const labels={pending:'Aguardando aceite',accepted:'Aceita — preparar contrato',prepared:'Aguardando assinatura',signed:'Assinada'};
    for(const record of [...visible].reverse().slice(0,10)){
      const row=document.createElement('tr');
      for(const value of [record.id,record.proposal.clientName,proposalScope(record.proposal),money(record.proposal.investment),labels[record.status]])row.append(el('td',value));
      tbody.append(row);
    }
    if(!visible.length){const row=document.createElement('tr'),cell=el('td','Suas propostas compartilhadas ativas aparecerão aqui.');cell.colSpan=5;row.append(cell);tbody.append(row);}
    const metrics=document.querySelectorAll('.metric');
    const stats=[['Propostas',String(visible.length),'Ativas na sua conta'],['Valor em propostas',money(visible.reduce((sum,r)=>sum+r.proposal.investment,0)),'Total sem arquivadas'],['Potência projetada',number(visible.reduce((sum,r)=>sum+(Number(r.proposal.installedKwp)||0),0))+' kWp','Propostas ativas']];
    metrics.forEach((metric,i)=>{if(stats[i]){metric.querySelector('small').textContent=stats[i][0];metric.querySelector('strong').textContent=stats[i][1];metric.querySelector('em').textContent=stats[i][2];}});
    const clients=$('#clients');clients.classList.remove('empty-state');clients.replaceChildren();
    const heading=el('div','','panel-heading'),headingText=el('div');
    headingText.append(el('h2','Clientes'),el('p','Clientes criados a partir das propostas compartilhadas.'));
    heading.append(headingText);
    if(window.SolarAuth?.user?.role==='admin'){
      const cleanup=el('button','Excluir registros de teste','ghost danger');
      cleanup.disabled=!records.some(record=>record.isTest);
      cleanup.onclick=deleteTestRecords;
      heading.append(cleanup);
    }
    clients.append(heading);
    const groups=new Map();
    for(const record of visible){
      const key=recordClientKey(record);
      if(!groups.has(key))groups.set(key,{proposal:record.proposal,records:records.filter(item=>recordClientKey(item)===key)});
    }
    for(const [key,group] of groups){
      const client=group.proposal,row=el('div','','contract-row'),info=el('div');
      info.append(el('strong',client.clientName),el('small',client.city+'/'+client.state+' · '+group.records.length+' proposta(s)'+(group.records.some(record=>record.isTest)?' · Teste':'')));
      const actions=el('div','','record-actions'),remove=el('button','Deletar cliente','ghost danger');
      remove.disabled=!group.records.every(canDeleteRecord);
      remove.title=remove.disabled?'Cliente com proposta aceita, contrato ou assinatura não pode ser deletado.':'Deletar cliente e propostas sem aceite';
      remove.onclick=()=>deleteClient(key,client.clientName);
      actions.append(remove);row.append(info,actions);clients.append(row);
    }
    if(!groups.size)clients.append(el('p','Os clientes das suas propostas compartilhadas aparecerão aqui.'));
  }
  function proposalReady(proposal){
    pending={id:uid(),proposal:ContractCore.clone(proposal)};
    $('#pNumber').textContent=pending.id;
    $('#proposalApprovalStatus').textContent='Aguardando aceite do cliente · '+pending.id;
    $('#shareProposal').disabled=false;$('#customerLink').hidden=true;$('#acceptanceMessage').textContent='';loginShortcut.hidden=true;returnToProposal.hidden=false;
  }
  window.addEventListener('proposalbuilt',event=>proposalReady(event.detail));
  if(lastResult)proposalReady(lastResult);
  function showRecordLink(record,target){
    let link=target.querySelector('.customer-link');
    if(!link){link=el('a','','customer-link');link.target='_blank';link.rel='noopener noreferrer';target.append(link);}
    link.href=record.publicPath;link.textContent=new URL(record.publicPath,location.href).href;
  }
  $('#shareProposal').onclick=async()=>{
    try{
      if(!pending)throw new Error('Gere uma proposta completa.');
      $('#shareProposal').disabled=true;
      loginShortcut.hidden=true;$('#acceptanceMessage').textContent='Gerando link…';
      const record=await api('records',{method:'POST',body:JSON.stringify({proposal:pending.proposal,isTest:$('#testRecord').checked})});
      pending.id=record.id;$('#pNumber').textContent=record.id;
      $('#proposalApprovalStatus').textContent='Aguardando aceite · '+record.id;
      const link=$('#customerLink');link.href=record.publicPath;link.textContent=new URL(record.publicPath,location.href).href;link.hidden=false;
      $('#acceptanceMessage').textContent='Compartilhe este link com o cliente. Válido por 3 dias para aceite.';
      await refresh();
    }catch(error){$('#acceptanceMessage').textContent=error.message;loginShortcut.hidden=error.code!=='AUTH_REQUIRED';$('#shareProposal').disabled=false;}
  };
  const definitions=[
    ['company','Razão social da contratada','PÓRTICO SOLAR ENERGY COMÉRCIO E REPRESENTAÇÃO LTDA'],
    ['companyDocument','CNPJ da contratada','18.290.532/0001-76'],
    ['companyAddress','Endereço da contratada','Rua Benjamin Constant, 2369 - Jardim São Carlos, Alfenas/MG'],
    ['representative','Representante da contratada','Antônio Carlos da Cruz Junior'],
    ['engineer','Responsável técnico / CREA','Lucas da Silva Pascoal - Eng. Eletricista - CREA 94571 D-MG'],
    ['utility','Distribuidora','CEMIG'],['structure','Estrutura de fixação','Telhado cerâmico'],
    ['deadline','Prazo de execução (dias após assinatura)','60','number'],
    ['payment','Condições de pagamento','80% na assinatura do contrato e 20% após a instalação.'],
    ['additional','Serviços adicionais','Nenhum serviço adicional.'],
    ['meter','Condições de vistoria e medição','Conforme análise e aprovação da distribuidora.'],
    ['jurisdiction','Foro / comarca','Alfenas, MG'],['date','Data do contrato',today(),'date'],
    ['backup','Circuitos incluídos no backup','','text'],
    ['witness1','1ª testemunha / CPF','','text',true],['witness2','2ª testemunha / CPF','','text',true]
  ];
  for(const [name,label,value,type='text',optional=false] of definitions){
    const wrap=el('label',label),input=document.createElement('input');input.name=name;input.value=value;input.type=type;input.required=!optional;
    if(type==='number'){input.min='1';input.step='1';}
    wrap.append(input);$('#contractFields').append(wrap);
  }
  function open(id){
    current=records.find(r=>r.id===id);if(!current)return;
    $('#contractTitle').textContent=current.proposal.clientName+' · '+id;
    $('#acceptanceSummary').textContent=`Aceite registrado por ${current.acceptance.name}, via ${current.acceptance.channel}, em ${new Date(current.acceptance.date).toLocaleString('pt-BR')}. Comprovante: ${current.acceptance.evidence}.`;
    const f=$('#contractForm');
    f.hidden=current.status==='signed';
    let links=$('#contractLinks');if(!links){links=el('div','','contract-links');links.id='contractLinks';$('#acceptanceSummary').after(links);}links.replaceChildren();showRecordLink(current,links);
    for(const [name,,value] of definitions)f.elements[name].value=current.contract?.details[name]??value;
    f.elements.date.value=current.contract?.details.date||today();
    if(!current.contract){
      const proposalServices=ContractCore.services?.(current.proposal);
      if(proposalServices)f.elements.additional.value=proposalServices;
    }
    f.elements.backup.disabled=!current.proposal.hybrid;f.elements.backup.parentElement.hidden=!current.proposal.hybrid;
    $('#contractReview').hidden=!current.contract||current.status==='signed';$('#contractText').value=current.contract?.text||'';
    $('#printDraft').disabled=!current.contract;
    $('#reviewConfirmed').checked=false;$('#contractMessage').textContent='';
    $('#contractDocument').hidden=!current.contract;$('#printContract').disabled=!current.contract;
    if(current.contract)renderDocument(current);
    showView('contract');
  }
  $('#contractForm').onsubmit=event=>{
    event.preventDefault();
    try{
      const details=Object.fromEntries(new FormData(event.currentTarget));
      $('#contractText').value=ContractCore.generate(current,details,window.CONTRACT_TEMPLATE);
      $('#contractReview').hidden=false;$('#reviewConfirmed').checked=false;$('#printContract').disabled=true;$('#printDraft').disabled=false;
      $('#contractDocument').hidden=true;$('#contractMessage').textContent='Minuta preparada. Revise o texto e salve a versão para assinatura.';
    }catch(error){$('#contractMessage').textContent=error.message;}
  };
  const dirty=()=>{$('#printContract').disabled=true;$('#reviewConfirmed').checked=false;$('#contractDocument').hidden=true;};
  $('#contractForm').addEventListener('input',()=>{dirty();$('#contractReview').hidden=true;});
  $('#contractText').addEventListener('input',dirty);
  $('#saveContract').onclick=async()=>{
    try{
      if(!$('#reviewConfirmed').checked)throw new Error('Confirme a revisão do texto antes de salvar.');
      const text=$('#contractText').value.trim();if(!text)throw new Error('O texto do contrato está vazio.');
      const next=await api('records/'+current.id+'/contract',{method:'PUT',body:JSON.stringify({text,details:Object.fromEntries(new FormData($('#contractForm'))),reviewed:true,previousRevision:current.contract?.revision||0})});
      records=records.map(r=>r.id===next.id?next:r);current=next;renderDocument(current);
      $('#printContract').disabled=false;$('#contractMessage').textContent='Versão '+next.contract.revision+' salva. Contrato disponível para assinatura no link do cliente.';
    }catch(error){$('#contractMessage').textContent=error.message;}
  };
  function renderDocument(record){
    renderTextDocument(record.id,'Versão '+record.contract.revision,record.contract.text,record.signature);
  }
  function renderTextDocument(id,label,text,signature){
    const target=$('#contractDocument');target.replaceChildren();target.hidden=false;
    const header=el('header','','contract-letterhead');header.append(el('strong','PÓRTICO / SOLAR ENERGY'),el('small',id+' · '+label));target.append(header);
    text.split(/\n\s*\n/).forEach((part,index)=>target.append(el(index===0?'h1':'p',part)));
    if(signature){
      const evidence=el('section','','contract-annex');
      evidence.append(el('h2','Registro de assinatura eletrônica simples'));
      for(const item of [signature.name,signature.document,signature.email,new Date(signature.date).toLocaleString('pt-BR'),signature.method,'SHA-256: '+signature.hash])evidence.append(el('p',item));
      target.append(evidence);
    }
  }
  $('#backContracts').onclick=()=>{refresh();showView('contracts');};
  $('#printContract').onclick=()=>{document.body.dataset.print='contract';window.print();};
  $('#printDraft').onclick=()=>{
    const text=$('#contractText').value.trim();
    if(!text){$('#contractMessage').textContent='Prepare a minuta antes de imprimir.';return;}
    renderTextDocument(current.id,'Minuta para revisão',text,null);
    document.body.dataset.print='contract';window.print();
  };
  refresh();
})();
