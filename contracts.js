(()=>{
  
  let records=[], current=null, pending=null, editingRecord=null, displayedRecord=null, saving=null;
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
  approval.innerHTML='<h3>Aceite e assinatura por link</h3><p id="proposalApprovalStatus">Crie o link para o cliente revisar e aceitar esta proposta.</p><div id="procurementSummary" class="field-help" hidden></div><label class="check-label test-record-label"><input type="checkbox" id="testRecord">Registro de teste</label><button class="primary" id="shareProposal">Gerar link do cliente</button><p id="acceptanceMessage" role="status"></p><a id="customerLink" target="_blank" rel="noopener noreferrer" hidden></a>';
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
  document.querySelector('[data-view="clients"]').addEventListener('click',refresh);
  $('#proposalBackClients').onclick=()=>{refresh();showView('clients');};
  const editNotice=el('p','','field-help budget-edit-notice');editNotice.id='quoteEditingNotice';editNotice.hidden=true;$('#quoteForm').before(editNotice);
  window.addEventListener('newquotestarted',()=>{
    editingRecord=null;displayedRecord=null;pending=null;window.editDisplayedBudget=null;
    editNotice.hidden=true;$('#proposalBackClients').hidden=true;$('#saveBudget').hidden=false;
    $('#testRecord').disabled=false;$('#testRecord').checked=false;
  });
  const activeRecords=()=>records.filter(record=>record.status!=='archived');
  const recordClientKey=record=>record.proposal.document||record.proposal.clientName;
  const proposalScope=proposal=>proposal.quoteType==='services'?'Serviços':number(Number(proposal.installedKwp)||0)+' kWp';
  const canDeleteRecord=record=>!record.acceptance&&['pending','archived'].includes(record.status);
  function renderProcurementSummary(proposal){
    const target=$('#procurementSummary');target.replaceChildren();target.hidden=false;
    const source=proposal?.pricingSource||proposal?.pricingSnapshot?.pricingSource||'LEGACY';
    target.append(el('strong','Fonte do custo: '+source));
    if(source!=='PROCUREMENT'){target.append(el('p','Precificação manual/legada.'));return;}
    const snapshot=proposal?.pricingSnapshot?.procurementSnapshot;
    if(!snapshot){target.append(el('p','REVISÃO COMERCIAL NECESSÁRIA: snapshot de procurement indisponível.'));return;}
    const details=[
      `Kit: ${snapshot.kitName||snapshot.kitId||'não informado'}`,
      `Fornecedor: ${snapshot.supplierName||snapshot.supplierId||'não informado'}`,
      `Oferta: ${snapshot.supplierKitOfferId||'não informado'}`,
      `Estoque: ${snapshot.stockStatus||'UNKNOWN'}`,
      `Prazo: ${snapshot.leadTimeDays===null||snapshot.leadTimeDays===undefined?'desconhecido':snapshot.leadTimeDays+' dias'}`,
      `Modo: ${snapshot.selectionMode||proposal.selectionMode||'AUTO'}`
    ];
    for(const detail of details)target.append(el('span',detail+' · '));
    if(snapshot.requiresReview||proposal.pricingSnapshot.requiresReview){
      target.append(el('p','REVISÃO COMERCIAL NECESSÁRIA'+(snapshot.blockingReasons?.length?': '+snapshot.blockingReasons.join(', '):'.')));
    }
  }
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
    headingText.append(el('h2','Clientes e orçamentos'),el('p','Consulte, edite e imprima os orçamentos salvos de cada cliente.'));
    heading.append(headingText);
    const reloadClients=el('button','Atualizar','ghost');reloadClients.onclick=refresh;heading.append(reloadClients);
    if(window.SolarAuth?.user?.role==='admin'){
      const cleanup=el('button','Excluir registros de teste','ghost danger');
      cleanup.disabled=!records.some(record=>record.isTest);
      cleanup.onclick=deleteTestRecords;
      heading.append(cleanup);
    }
    clients.append(heading);
    const clientMessage=el('p','','field-help');clientMessage.id='clientBudgetMessage';clientMessage.setAttribute('role','status');clients.append(clientMessage);
    const groups=new Map();
    for(const record of [...visible].reverse()){
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
      actions.append(remove);row.append(info,actions);
      const card=el('article','','client-budget-card');card.append(row);
      const currentBudget=[...group.records].reverse().find(record=>record.status!=='archived');
      for(const record of [...group.records].reverse()){
        const budget=el('div','','client-budget-row'),summary=el('div','','client-budget-summary');
        summary.append(el('strong',record.id),el('small',proposalScope(record.proposal)+' · '+money(record.proposal.investment)+' · '+(labels[record.status]||'Arquivada')+(record.id===currentBudget?.id?' · Atual':'')+(record.sourceRecordId?' · Revisão de '+record.sourceRecordId:'')));
        const buttons=el('div','','record-actions');
        const view=el('button','Visualizar orçamento','ghost');view.onclick=()=>viewBudget(record.id);
        const edit=el('button',record.status==='pending'&&!record.acceptance?'Editar orçamento':'Criar nova versão','ghost');edit.onclick=()=>editBudget(record.id);
        const print=el('button','Imprimir / PDF','ghost');print.onclick=()=>viewBudget(record.id,true);
        buttons.append(view,edit,print);budget.append(summary,buttons);card.append(budget);
      }
      clients.append(card);
    }
    if(!groups.size)clients.append(el('p','Os clientes das suas propostas compartilhadas aparecerão aqui.'));
  }
  function proposalReady(proposal){
    const updateExisting=editingRecord?.status==='pending'&&!editingRecord.acceptance;
    pending={id:updateExisting?editingRecord.id:uid(),proposal:ContractCore.clone(proposal),recordId:updateExisting?editingRecord.id:null,previousRevision:editingRecord?.proposalRevision||0,sourceRecordId:editingRecord&&!updateExisting?editingRecord.id:null,saved:false};
    displayedRecord=null;window.editDisplayedBudget=null;
    $('#saveBudget').hidden=false;$('#saveBudget').disabled=false;
    $('#saveBudget').textContent=updateExisting?'Salvar alterações':editingRecord?'Salvar nova versão':'Salvar orçamento';
    $('#testRecord').disabled=!!editingRecord;if(editingRecord)$('#testRecord').checked=!!editingRecord.isTest;
    $('#shareProposal').textContent='Gerar link do cliente';$('#editQuote').textContent='← Editar dados';
    $('#pNumber').textContent=pending.id;
    $('#proposalApprovalStatus').textContent='Aguardando aceite do cliente · '+pending.id;
    renderProcurementSummary(pending.proposal);$('#shareProposal').disabled=false;$('#customerLink').hidden=true;$('#acceptanceMessage').textContent='';loginShortcut.hidden=true;returnToProposal.hidden=false;
  }
  window.addEventListener('proposalbuilt',event=>proposalReady(event.detail));
  if(lastResult)proposalReady(lastResult);
  function showRecordLink(record,target){
    let link=target.querySelector('.customer-link');
    if(!link){link=el('a','','customer-link');link.target='_blank';link.rel='noopener noreferrer';target.append(link);}
    link.href=record.publicPath;link.textContent=new URL(record.publicPath,location.href).href;
  }
  async function viewBudget(id,print=false){
    try{
      const record=await api('records/'+id);
      displayedRecord=record;editingRecord=null;pending=null;
      buildProposal(record.proposal,{notify:false,issuedAt:record.updatedAt||record.createdAt||record.expiresAt-3*86400000});
      $('#pNumber').textContent=record.id;
      $('#saveBudget').hidden=true;$('#proposalBackClients').hidden=false;
      $('#editQuote').textContent=record.acceptance?'Criar nova versão':'Editar orçamento';
      window.editDisplayedBudget=()=>editBudget(record.id);
      $('#proposalApprovalStatus').textContent=record.acceptance?'Proposta aceita em '+new Date(record.acceptance.date).toLocaleString('pt-BR')+' · '+record.id:'Orçamento salvo · '+record.id;
      renderProcurementSummary(record.proposal);$('#shareProposal').disabled=true;
      $('#testRecord').checked=!!record.isTest;$('#testRecord').disabled=true;
      $('#customerLink').href=record.publicPath;$('#customerLink').textContent=new URL(record.publicPath,location.href).href;$('#customerLink').hidden=record.status==='archived';
      $('#acceptanceMessage').textContent=record.acceptance?'Esta é a proposta aceita. Para alterar os dados, crie uma nova versão.':'';
      returnToProposal.hidden=false;showView('proposal');
      if(print){await document.fonts.ready;window.print();}
    }catch(error){$('#clientBudgetMessage').textContent=error.message;showView('clients');}
  }
  async function editBudget(id){
    try{
      const record=await api('records/'+id);
      editingRecord=record;displayedRecord=null;pending=null;window.editDisplayedBudget=null;
      restoreQuoteForm(ContractCore.clone(record.proposal));
      editNotice.textContent=record.status==='pending'&&!record.acceptance?'Editando orçamento '+record.id+'. Gere a proposta e clique em Salvar alterações.':'Nova versão baseada no orçamento '+record.id+'. O orçamento anterior e seu aceite serão preservados.';
      editNotice.hidden=false;$('#proposalBackClients').hidden=false;
    }catch(error){$('#clientBudgetMessage').textContent=error.message;}
  }
  async function persistBudget(){
    if(!pending)throw new Error('Gere uma proposta completa.');
    if(pending.saved)return pending.record;
    if(saving)return saving;
    const draft=pending;
    $('#saveBudget').disabled=true;$('#shareProposal').disabled=true;
    saving=(async()=>{
      const payload={id:draft.id,proposal:draft.proposal,isTest:$('#testRecord').checked,sourceRecordId:draft.sourceRecordId,previousRevision:draft.previousRevision};
      const record=await api(draft.recordId?'records/'+draft.recordId+'/proposal':'records',{method:draft.recordId?'PUT':'POST',body:JSON.stringify(payload)});
      if(pending===draft){
        Object.assign(draft,{id:record.id,recordId:record.id,previousRevision:record.proposalRevision||0,saved:true,record});
        draft.proposal=ContractCore.clone(record.proposal);
        buildProposal(record.proposal,{notify:false,issuedAt:record.updatedAt||record.createdAt});
        renderProcurementSummary(record.proposal);
        editingRecord=record;$('#pNumber').textContent=record.id;
        $('#proposalApprovalStatus').textContent='Orçamento salvo · '+record.id;
        $('#shareProposal').textContent='Ver link do cliente';
        $('#customerLink').href=record.publicPath;$('#customerLink').textContent=new URL(record.publicPath,location.href).href;$('#customerLink').hidden=false;
        $('#testRecord').disabled=true;$('#proposalBackClients').hidden=false;
      }
      await refresh();return record;
    })();
    try{return await saving;}finally{saving=null;$('#saveBudget').disabled=!!pending?.saved;$('#shareProposal').disabled=false;}
  }
  $('#saveBudget').onclick=async()=>{
    try{await persistBudget();$('#acceptanceMessage').textContent='Orçamento salvo. Você pode reabri-lo e imprimir em Clientes.';}
    catch(error){$('#acceptanceMessage').textContent=error.message;}
  };
  $('#shareProposal').onclick=async()=>{
    try{
      if(!pending)throw new Error('Gere uma proposta completa.');
      $('#shareProposal').disabled=true;
      loginShortcut.hidden=true;$('#acceptanceMessage').textContent='Gerando link…';
      const record=await persistBudget();
      pending.id=record.id;$('#pNumber').textContent=record.id;
      $('#proposalApprovalStatus').textContent='Aguardando aceite · '+record.id;
      const link=$('#customerLink');link.href=record.publicPath;link.textContent=new URL(record.publicPath,location.href).href;link.hidden=false;
      $('#acceptanceMessage').textContent='Compartilhe este link com o cliente. Válido por 3 dias para aceite.';
      await refresh();
    }catch(error){$('#acceptanceMessage').textContent=error.message;loginShortcut.hidden=error.code!=='AUTH_REQUIRED';$('#shareProposal').disabled=false;}
  };
  const definitions=[
    ['company','Nome da empresa (contratada)',''],
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
    renderTextDocument(record.id,'Versão '+record.contract.revision,record.contract.text,record.signature,record.contract.details);
  }
  function createContractLetterhead(id,label,details={}){
    const header=el('header','','contract-print-header');
    header.append(el('strong',String(details.company||'').trim()||'Empresa contratada','contract-page-company'));
    const meta=el('div','','contract-page-meta');
    meta.append(el('div','TERMO DE CONTRATAÇÃO DE SERVIÇOS','contract-page-meta-title'));
    const row=el('div','','contract-page-meta-row');
    row.append(el('span',label),el('span',id));meta.append(row);header.append(meta);
    return header;
  }
  function createContractFooter(details={}){
    const footer=el('footer','','contract-print-footer');
    if(details.companyAddress)footer.append(el('div',details.companyAddress));
    if(details.companyDocument)footer.append(el('div','CNPJ: '+details.companyDocument));
    return footer;
  }
  function formatContractParagraph(paragraph){
    const text=paragraph.textContent;
    const heading=text.match(/^(?:[IVXLCDM]+\s*[–—-]\s*[^:]+:|Cláusula\s+\d+[^.]*\.|Parágrafo único\.)/i);
    if(heading){
      const strong=el('strong',heading[0]);
      if(/^[IVXLCDM]+\s*[–—-]/i.test(heading[0]))strong.className='contract-clause-heading';
      paragraph.replaceChildren(strong,document.createTextNode(text.slice(heading[0].length)));
    }else if(/^ANEXO\b/i.test(text))paragraph.classList.add('contract-annex-title');
    if(text.includes('_____'))paragraph.classList.add('contract-signature-block');
  }
  function renderTextDocument(id,label,text,signature,details={}){
    const target=$('#contractDocument');target.replaceChildren();target.hidden=false;
    target.append(createContractLetterhead(id,label,details));
    text.split(/\n\s*\n/).forEach((part,index)=>{
      const block=el(index===0?'h1':'p',part);
      if(index)formatContractParagraph(block);target.append(block);
    });
    target.append(createContractFooter(details));
    if(signature){
      const evidence=el('section','','contract-annex');
      evidence.append(el('h2','Registro de assinatura eletrônica simples'));
      for(const item of [signature.name,signature.document,signature.email,new Date(signature.date).toLocaleString('pt-BR'),signature.method,'SHA-256: '+signature.hash])evidence.append(el('p',item));
      target.append(evidence);
    }
  }
  $('#backContracts').onclick=()=>{refresh();showView('contracts');};
  function paginateContractDocument(source){
    document.querySelector('.contract-print-pages')?.remove();
    const pages=el('div','','contract-print-pages');
    pages.setAttribute('aria-hidden','true');document.body.append(pages);
    const sourceHeader=source.querySelector('.contract-print-header');
    const sourceFooter=source.querySelector('.contract-print-footer');
    let content;
    function newPage(){
      const sheet=el('section','','contract-print-sheet');
      content=el('div','','contract-page-body');
      const header=sourceHeader?.cloneNode(true)||el('header');header.className='contract-page-header';
      const footer=sourceFooter?.cloneNode(true)||el('footer');footer.className='contract-page-footer';
      sheet.append(header,content,footer);
      pages.append(sheet);
    }
    const fits=()=>!content.lastElementChild||content.lastElementChild.getBoundingClientRect().bottom<=content.getBoundingClientRect().bottom-1;
    function appendBlock(block){
      let copy=block.cloneNode(true);content.append(copy);
      if(fits())return;
      const blockHeight=copy.getBoundingClientRect().height;
      copy.remove();
      // Keep paragraphs and signature lines together when they fit on a fresh sheet.
      if(content.childElementCount&&blockHeight<=content.getBoundingClientRect().height-1){
        newPage();content.append(copy);return;
      }
      if(block.matches('h1,h2')){
        if(content.childElementCount)newPage();
        content.append(copy);return;
      }
      // Split oversized paragraphs at word boundaries, preserving every character.
      let tokens=block.textContent.match(/\s+|\S+\s*/g)||[];
      while(tokens.length){
        copy=block.cloneNode(false);content.append(copy);
        let low=0,high=tokens.length;
        while(low<high){
          const middle=Math.ceil((low+high)/2);
          copy.textContent=tokens.slice(0,middle).join('');
          formatContractParagraph(copy);
          if(fits())low=middle;else high=middle-1;
        }
        if(!low){
          copy.remove();
          if(content.childElementCount){newPage();continue;}
          // A single unbroken value can itself be longer than a sheet.
          if(tokens[0].length>1){tokens=[...tokens[0],...tokens.slice(1)];continue;}
          throw new Error('Não foi possível paginar o texto da minuta.');
        }
        copy.textContent=tokens.splice(0,low).join('');formatContractParagraph(copy);
        if(tokens.length)newPage();
      }
    }
    newPage();
    for(const block of source.children){
      if(block.matches('.contract-print-header,.contract-print-footer'))continue;
      if(block.matches('.contract-annex')){
        if(content.childElementCount)newPage();
        for(const child of block.children)appendBlock(child);
      }else{
        // Keep a heading with enough space for the start of the next paragraph.
        if(block.matches('h1,h2')&&content.childElementCount&&content.getBoundingClientRect().bottom-content.lastElementChild.getBoundingClientRect().bottom<100)newPage();
        appendBlock(block);
      }
    }
    return pages;
  }
  window.addEventListener('beforeprint',()=>{
    if(document.body.dataset.print==='contract'&&!$('#contractDocument').hidden)paginateContractDocument($('#contractDocument'));
  });
  window.addEventListener('afterprint',()=>document.querySelector('.contract-print-pages')?.remove());
  async function printContractDocument(){
    await document.fonts.ready;
    paginateContractDocument($('#contractDocument'));
    const previousTitle=document.title;
    const restore=()=>{document.title=previousTitle;window.removeEventListener('afterprint',restore);};
    document.title='';
    window.addEventListener('afterprint',restore,{once:true});
    document.body.dataset.print='contract';
    window.print();
  }
  $('#printContract').onclick=printContractDocument;
  $('#printDraft').onclick=()=>{
    const text=$('#contractText').value.trim();
    if(!text){$('#contractMessage').textContent='Prepare a minuta antes de imprimir.';return;}
    const details=Object.fromEntries(new FormData($('#contractForm')));
    renderTextDocument(current.id,'Minuta para revisão',text,null,details);
    printContractDocument();
  };
  refresh();
})();
