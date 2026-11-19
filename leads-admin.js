(()=>{
  const root=document.querySelector('#leads');
  if(!root||!window.SolarApi)return;
  const api=SolarApi.createClient(),$=selector=>document.querySelector(selector);
  const labels={NEW:'Novo',CONTACTED:'Em contato',QUALIFIED:'Qualificado',PROPOSAL_SENT:'Proposta enviada',WON:'Fechado',LOST:'Perdido'};
  const companies={portico:'Pórtico Solar',gotex:'GoTex'};
  let page=1,selected=null,users=[];
  const date=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—';
  const node=(tag,text,className)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(className)item.className=className;return item;};
  const message=value=>{$('#leadListMessage').textContent=value||'';};
  const me=()=>window.SolarAuth?.user||null;
  const place=lead=>[lead.city,lead.state].filter(Boolean).join('/');
  function badge(status){return node('span',labels[status]||status,'diagnostic-status lead-status-'+String(status).toLowerCase());}
  function whatsappUrl(lead){
    let digits=String(lead.phone||'').replace(/\D/g,'');
    if(digits.length<10)return null;
    if(!digits.startsWith('55')||digits.length<=11)digits='55'+digits;
    const company=companies[lead.company]||'nossa equipe';
    const text=`Olá, ${lead.name.split(' ')[0]}! Aqui é ${me()?.name||'a equipe'} da ${company}. Recebemos sua solicitação (${lead.protocol}) e gostaria de conversar sobre o seu projeto.`;
    return 'https://wa.me/'+digits+'?text='+encodeURIComponent(text);
  }
  function filters(){return Object.fromEntries(Object.entries(Object.fromEntries(new FormData($('#leadFilters')))).filter(([,value])=>value));}
  function updateBadge(count){const target=$('#leadsBadge');target.hidden=!count;target.textContent=count>99?'99+':String(count||'');}
  function row(lead){
    const tr=node('tr');tr.tabIndex=0;tr.dataset.id=lead.id;if(lead.id===selected)tr.className='is-selected';
    const contact=node('td');contact.append(node('strong',lead.name),node('small',' · '+(companies[lead.company]||lead.company)));
    tr.append(node('td',lead.protocol),contact,node('td',place(lead)),node('td',date(lead.createdAt)));
    const status=node('td');status.append(badge(lead.status));tr.append(status);
    tr.onclick=()=>loadDetail(lead.id);tr.onkeydown=event=>{if(event.key==='Enter')loadDetail(lead.id);};
    return tr;
  }
  async function loadList(){
    if(!me()||me().mustChangePassword)return;
    try{
      const result=await api('admin/leads?'+new URLSearchParams({...filters(),page,pageSize:10}));
      $('#leadRows').replaceChildren(...result.items.map(row));
      $('#leadPage').textContent=`Página ${result.total?result.page:1} · ${result.total} registro(s)`;
      $('#leadPrev').disabled=result.page<=1;$('#leadNext').disabled=result.page*result.pageSize>=result.total;
      message(result.total?'':'Nenhum lead encontrado.');updateBadge(result.newCount);
    }catch(error){message(error.message);}
  }
  function metric(label,value,href){
    const box=node('div',undefined,'diagnostic-metric');box.append(node('small',label));
    const strong=node('strong');
    if(href&&value){const link=node('a',value);link.href=href;strong.append(link);}else strong.textContent=value||'Não informado';
    box.append(strong);return box;
  }
  function historyList(lead){
    const list=node('ol',undefined,'lead-history');
    const created=node('li');created.append(node('strong','Recebido pela página '+(lead.source||companies[lead.company]||'')),node('small',date(lead.createdAt)));list.append(created);
    for(const entry of lead.history||[]){
      const item=node('li'),parts=[];
      if(entry.status)parts.push(`Situação: ${labels[entry.status.from]||entry.status.from} → ${labels[entry.status.to]||entry.status.to}`);
      if(entry.assignedTo)parts.push(entry.assignedTo.to?'Responsável: '+(entry.assignedTo.name||'—'):'Responsável removido');
      item.append(node('strong',parts.join(' · ')||'Anotação'));
      if(entry.note)item.append(node('p',entry.note));
      item.append(node('small',`${entry.actorName||'—'} · ${date(entry.date)}`));
      list.append(item);
    }
    return list;
  }
  function parseLocation(lead){
    let city=lead.city.trim(),state=lead.state;
    if(!state){const match=city.match(/^(.*?)[\s,\/-]+([A-Za-z]{2})$/);if(match){city=match[1].trim();state=match[2].toUpperCase();}}
    const normalize=value=>String(value).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
    const known=window.SOLAR_LOCALITIES?.municipalities?.[state]?.find(item=>normalize(item.name)===normalize(city));
    return {state:known?state:(window.SOLAR_LOCALITIES?.municipalities?.[state]?state:''),city:known?.name||''};
  }
  function startQuoteFromLead(lead){
    if(typeof startQuote!=='function')return;
    startQuote('system');
    field('clientName').value=lead.name;field('phone').value=lead.phone;
    const location=parseLocation(lead);
    if(location.state){
      field('state').value=location.state;fillCities(location.state,location.city);
      if(location.city)field('city').dispatchEvent(new Event('change'));
      else setHspStatus('Confirme a cidade informada pelo lead: '+lead.city+'.');
    }
  }
  async function patch(lead,data,feedback){
    try{await api('admin/leads/'+lead.id,{method:'PATCH',body:JSON.stringify(data)});await loadDetail(lead.id);await loadList();}
    catch(error){feedback.textContent=error.message;}
  }
  function render(lead){
    const panel=$('#leadDetailPanel');panel.replaceChildren();
    const header=node('div',undefined,'detail-header'),heading=node('div');
    heading.append(node('span',lead.protocol+' · '+(companies[lead.company]||lead.company),'section-kicker'),node('h2',lead.name),node('p',`${place(lead)} · recebido em ${date(lead.createdAt)}`));
    header.append(heading,badge(lead.status));panel.append(header);

    const metrics=node('div',undefined,'diagnostic-metrics');
    metrics.append(metric('E-mail',lead.email,'mailto:'+lead.email),metric('Telefone / WhatsApp',lead.phone,lead.phone?'tel:'+lead.phone.replace(/[^\d+]/g,''):null),metric('Serviço',lead.service),metric('Responsável',lead.assignedName||'Sem responsável'));
    panel.append(metrics);
    if(lead.notes){const notes=node('div',undefined,'lead-notes');notes.append(node('small','Mensagem do cliente'),node('p',lead.notes));panel.append(notes);}

    const actions=node('div',undefined,'lead-actions');
    const wa=whatsappUrl(lead);
    if(wa){const link=node('a','Chamar no WhatsApp','primary lead-whatsapp');link.href=wa;link.target='_blank';link.rel='noopener noreferrer';link.onclick=()=>{if(lead.status==='NEW')patch(lead,{status:'CONTACTED',note:'Contato iniciado pelo WhatsApp.'},feedback);};actions.append(link);}
    const quote=node('button','Criar orçamento','ghost');quote.type='button';quote.onclick=()=>startQuoteFromLead(lead);actions.append(quote);
    const feedback=node('p','','diagnostic-message');
    if(me()?.role!=='admin'&&!lead.assignedTo){const take=node('button','Assumir atendimento','ghost');take.type='button';take.onclick=()=>patch(lead,{assignedTo:me().id},feedback);actions.append(take);}
    panel.append(actions);

    const formBox=node('form',undefined,'diagnostic-review-form');
    const subheading=node('div',undefined,'detail-subheading');subheading.append(node('h3','Atendimento'));formBox.append(subheading);
    const statusLabel=node('label','Situação'),status=node('select');status.name='status';
    for(const [value,label] of Object.entries(labels))status.add(new Option(label,value,false,value===lead.status));
    statusLabel.append(status);formBox.append(statusLabel);
    if(me()?.role==='admin'){
      const ownerLabel=node('label','Responsável'),owner=node('select');owner.name='assignedTo';owner.add(new Option('Sem responsável',''));
      for(const user of users.filter(user=>user.active))owner.add(new Option(`${user.name} · ${user.role==='admin'?'Administrador':'Vendedor'}`,user.id,false,user.id===lead.assignedTo));
      ownerLabel.append(owner);formBox.append(ownerLabel);
    }
    const noteLabel=node('label','Anotação'),note=node('textarea');note.name='note';note.rows=3;note.maxLength=2000;note.placeholder='Ex.: cliente pediu retorno à tarde; enviar fatura';
    noteLabel.append(note);formBox.append(noteLabel);
    const save=node('button','Salvar atendimento','ghost');save.type='submit';formBox.append(save,feedback);
    formBox.onsubmit=event=>{
      event.preventDefault();const data=Object.fromEntries(new FormData(formBox));
      if(!data.note)delete data.note;if(data.status===lead.status)delete data.status;
      if(data.assignedTo!==undefined&&(data.assignedTo||null)===lead.assignedTo)delete data.assignedTo;
      if(!Object.keys(data).length){feedback.textContent='Nenhuma alteração para salvar.';return;}
      patch(lead,data,feedback);
    };
    panel.append(formBox);

    const history=node('div',undefined,'lead-history-box');history.append(node('h3','Histórico'),historyList(lead));panel.append(history);
  }
  async function loadDetail(id){
    selected=id;
    try{render(await api('admin/leads/'+id));document.querySelectorAll('#leadRows tr').forEach(tr=>tr.classList.toggle('is-selected',tr.dataset.id===id));}
    catch(error){message(error.message);}
  }
  async function loadUsers(){if(me()?.role!=='admin'){users=[];return;}try{users=await api('users');}catch{users=[];}}
  $('#leadFilters').addEventListener('submit',event=>{event.preventDefault();page=1;loadList();});
  $('#leadPrev').onclick=()=>{page=Math.max(1,page-1);loadList();};
  $('#leadNext').onclick=()=>{page++;loadList();};
  $('#leadRefresh').onclick=loadList;
  $('[data-view="leads"]').addEventListener('click',loadList);
  window.addEventListener('authchanged',async()=>{await loadUsers();loadList();});
  setInterval(()=>{if(!document.hidden)loadList();},120000);
})();
