(()=>{
  const settings=document.querySelector('#settings');
  if(!settings||!window.SolarApi)return;
  const api=SolarApi.createClient(),$=selector=>document.querySelector(selector);
  const panel=document.createElement('div');panel.className='panel supplier-import-panel';panel.innerHTML=`
    <div class="panel-heading"><div><span class="section-kicker">CATÁLOGO / SUPPLIER HUB</span><h2>Importações de fornecedores</h2><p>O upload apenas cria staging. Valide, revise o diff e publique explicitamente para alimentar as ofertas comerciais.</p></div></div>
    <form id="supplierImportForm"><div class="form-grid">
      <label>Fornecedor<select name="supplierId" required></select></label>
      <label>Arquivo CSV<input name="file" type="file" accept=".csv,text/csv" required></label>
      <label>Separador<select name="delimiter"><option value="">Detectar automaticamente</option><option value=";">Ponto e vírgula (;)</option><option value=",">Vírgula (,)</option><option value="\t">Tabulação</option></select></label>
      <label>Formato decimal<select name="decimalFormat"><option value="">Detectar com validação</option><option value="BR">Brasileiro</option><option value="INTERNATIONAL">Internacional</option></select></label>
      <label>Moeda padrão<input name="defaultCurrency" value="BRL" maxlength="3" placeholder="BRL"></label>
      <label>Mapeamento JSON (opcional)<textarea name="mapping" rows="2" placeholder='{"supplierSku":"COD_PROD","price":"VALOR"}'></textarea></label>
    </div><button class="primary" type="submit">Enviar para staging</button></form>
    <p id="supplierImportMessage" role="status"></p><div id="supplierImportList"></div>`;
  settings.append(panel);
  const form=panel.querySelector('#supplierImportForm'),message=panel.querySelector('#supplierImportMessage'),supplierSelect=form.elements.supplierId,list=panel.querySelector('#supplierImportList');
  const money=value=>value===null||value===undefined?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
  const date=value=>value?new Date(Number(value)).toLocaleString('pt-BR'):'—';
  const text=value=>value===null||value===undefined?'—':String(value);
  async function loadSuppliers(){
    const suppliers=await api('admin/suppliers');supplierSelect.replaceChildren();
    suppliers.filter(supplier=>supplier.active).forEach(supplier=>{const option=document.createElement('option');option.value=supplier.id;option.textContent=supplier.name;supplierSelect.append(option);});
  }
  function addButton(label,handler,disabled=false){const button=document.createElement('button');button.className='ghost';button.type='button';button.textContent=label;button.disabled=disabled;button.onclick=async()=>{button.disabled=true;try{await handler();}catch(error){message(error.message);}finally{button.disabled=false;}};return button;}
  function render(batches){
    list.replaceChildren();if(!batches.length){list.append(Object.assign(document.createElement('p'),{textContent:'Nenhuma importação recebida.'}));return;}
    batches.forEach(batch=>{
      const article=document.createElement('article');article.className='team-row';
      const info=document.createElement('div');const title=document.createElement('strong');title.textContent=`${batch.fileName||'Importação'} · ${batch.status}`;const details=document.createElement('small');details.textContent=`${batch.sourceType} · ${batch.totalRecords} registros · ${batch.validRecords} válidos · ${batch.invalidRecords} inválidos · ${date(batch.createdAt)}`;info.append(title,details);article.append(info);
      const actions=document.createElement('div');actions.className='proposal-actions';
      actions.append(addButton('Dry run',async()=>{const report=await api('admin/supplier-imports/'+batch.id+'/dry-run',{method:'POST'});message(`${report.summary.new} novos, ${report.summary.updated} atualizados, ${report.warnings.length} warnings; nenhuma gravação comercial.`);await load();}));
      actions.append(addButton('Ver diff',async()=>{const diff=await api('admin/supplier-imports/'+batch.id+'/diff');const details=document.createElement('details');details.open=true;const summary=document.createElement('summary');summary.textContent='Diff da importação';const pre=document.createElement('pre');pre.textContent=JSON.stringify(diff,null,2);details.append(summary,pre);article.append(details);}));
      if(batch.status==='REVIEW_REQUIRED'||batch.status==='READY_TO_PUBLISH')actions.append(addButton('Publicar',async()=>{const confirmReview=batch.status==='REVIEW_REQUIRED'&&window.confirm('Há itens ou alterações em revisão. Publicar mesmo assim?');if(batch.status==='REVIEW_REQUIRED'&&!confirmReview)return;await api('admin/supplier-imports/'+batch.id+'/publish',{method:'POST',body:JSON.stringify({confirmReview})});message('Importação publicada com sucesso.');await load();}));
      if(!['PUBLISHED','CANCELLED','FAILED'].includes(batch.status))actions.append(addButton('Cancelar',async()=>{if(!window.confirm('Cancelar esta importação?'))return;await api('admin/supplier-imports/'+batch.id+'/cancel',{method:'POST'});message('Importação cancelada.');await load();}));
      article.append(actions);
      if(batch.warnings?.length||batch.errors?.length){const notes=document.createElement('small');notes.textContent=[...(batch.errors||[]),...(batch.warnings||[]).map(item=>item.code||item)].join(' · ');article.append(notes);}
      list.append(article);
    });
  }
  async function load(){try{render(await api('admin/supplier-imports'));}catch(error){message(error.message);}}
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const file=form.elements.file.files[0];if(!file)throw new Error('Selecione um arquivo CSV.');let mapping={};if(form.elements.mapping.value.trim())mapping=JSON.parse(form.elements.mapping.value);
      await api('admin/supplier-imports',{method:'POST',body:JSON.stringify({supplierId:supplierSelect.value,sourceType:'CSV',fileName:file.name,content:await file.text(),delimiter:form.elements.delimiter.value||undefined,decimalFormat:form.elements.decimalFormat.value||undefined,defaultCurrency:form.elements.defaultCurrency.value.trim().toUpperCase()||undefined,mapping})});form.reset();form.elements.defaultCurrency.value='BRL';message('Arquivo recebido em staging. Revise o diff antes de publicar.');await load();
    }catch(error){message(error.message);}finally{button.disabled=false;}
  });
  panel.querySelector('#supplierImportMessage').textContent='';
  const settingsNav=document.querySelector('[data-view="settings"]');settingsNav?.addEventListener('click',async()=>{try{await loadSuppliers();await load();}catch(error){message(error.message);}});
  window.addEventListener('authchanged',async event=>{if(event.detail?.role==='admin'){try{await loadSuppliers();await load();}catch(error){message(error.message);}}});
})();
