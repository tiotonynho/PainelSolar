(()=>{
  const form=document.querySelector('#diagnosticForm');
  if(!form)return;
  const steps=[...form.querySelectorAll('.form-step')],progress=document.querySelector('#progressBar'),stepLabel=document.querySelector('#stepLabel'),errorBox=document.querySelector('#formError'),prev=document.querySelector('#prevStep'),next=document.querySelector('#nextStep'),fileInput=document.querySelector('#attachment'),fileHelp=document.querySelector('#fileHelp');
  const stepIndicators=[...document.querySelectorAll('.form-stepper li')];
  const navLinks=[...document.querySelectorAll('.public-nav-item')];
  const formCard=document.querySelector('.form-card');
  const scrollToForm=()=>formCard.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  let navigationFrame;
  function updateNavigation(){
    const threshold=document.querySelector('.site-header').getBoundingClientRect().bottom+60;
    let current=navLinks[0];
    for(const link of navLinks){if(document.querySelector(link.hash).getBoundingClientRect().top<=threshold)current=link;}
    navLinks.forEach(link=>{const active=link===current;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
    navigationFrame=null;
  }
  function scheduleNavigation(){if(!navigationFrame)navigationFrame=requestAnimationFrame(updateNavigation);}
  window.addEventListener('scroll',scheduleNavigation,{passive:true});
  window.addEventListener('resize',scheduleNavigation);
  updateNavigation();
  let currentStep=1,submitting=false;
  const submissionKey=(()=>{const key=crypto.randomUUID?.();return key||`${Date.now()}-${Math.random().toString(36).slice(2)}`;})();
  const params=new URLSearchParams(location.search),utm={};for(const key of ['source','medium','campaign','term','content']){const value=params.get(`utm_${key}`);if(value)utm[key]=value.slice(0,120);}
  const setError=text=>{errorBox.textContent=text||'';};
  function showStep(step,focus=false){
    currentStep=step;
    steps.forEach((item,index)=>{const active=index+1===step;item.hidden=!active;item.classList.toggle('active',active);});
    stepIndicators.forEach((item,index)=>{
      const active=index+1===step;
      item.classList.toggle('active',active);
      item.classList.toggle('complete',index+1<step);
      if(active)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
    });
    progress.style.width=`${step/steps.length*100}%`;
    stepLabel.textContent=`Etapa ${step} de ${steps.length}`;
    progress.parentElement.setAttribute('aria-valuenow',step);
    progress.parentElement.setAttribute('aria-valuetext',stepLabel.textContent);
    prev.hidden=step===1;
    next.textContent=step===steps.length?'Enviar solicitação':'Continuar';
    setError('');
    if(focus){const heading=steps[step-1].querySelector('legend');heading.tabIndex=-1;heading.focus({preventScroll:true});scrollToForm();}
  }
  function checkStep(step){
    const fields=[...steps[step-1].querySelectorAll('input,select,textarea')];
    for(const field of fields){if(field.type==='file'||field.type==='checkbox')continue;field.value=field.value.trim();if(field.required&&!field.value){field.reportValidity();return false;}if(!field.checkValidity()){field.reportValidity();return false;}}
    if(step===2&&!form.elements.averageConsumptionKwh.value&&!form.elements.averageBillAmount.value){setError('Informe o consumo médio, o valor da conta ou os dois.');return false;}
    if(step===3&&!form.elements.privacyAccepted.checked){form.elements.privacyAccepted.reportValidity();return false;}
    return true;
  }
  function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Não foi possível ler o anexo.'));reader.readAsDataURL(file);});}
  fileInput.addEventListener('change',()=>{const file=fileInput.files[0];if(!file){fileHelp.textContent='Nenhum arquivo selecionado.';return;}fileHelp.textContent=`${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`;});
  prev.addEventListener('click',()=>showStep(Math.max(1,currentStep-1),true));
  form.addEventListener('submit',event=>{event.preventDefault();next.click();});
  next.addEventListener('click',async()=>{
    if(!checkStep(currentStep)||submitting)return;
    if(currentStep<steps.length){showStep(currentStep+1,true);return;}
    submitting=true;next.disabled=true;prev.disabled=true;next.textContent='Enviando…';setError('');
    try{
      const data=Object.fromEntries(new FormData(form));
      data.privacyAccepted=form.elements.privacyAccepted.checked;data.marketingOptIn=form.elements.marketingOptIn.checked;data.submissionKey=submissionKey;data.source='portico-diagnostico';data.utm=utm;
      if(data.averageConsumptionKwh)data.averageConsumptionKwh=Number(data.averageConsumptionKwh);else delete data.averageConsumptionKwh;
      if(data.averageBillAmount)data.averageBillAmount=Number(data.averageBillAmount);else delete data.averageBillAmount;
      const file=fileInput.files[0];delete data.attachment;if(file){if(file.size>4*1024*1024)throw new Error('O anexo deve ter no máximo 4 MB.');data.attachment={filename:file.name,contentType:file.type,data:await fileData(file)};}
      const response=await fetch('/api/public/diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),credentials:'same-origin'});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível enviar a solicitação.');
      form.hidden=true;document.querySelector('#formProgress').hidden=true;document.querySelector('#confirmation').hidden=false;document.querySelector('#protocol').textContent=payload.protocol;document.querySelector('#confirmationTitle').focus({preventScroll:true});scrollToForm();
    }catch(err){setError(err.message||'Não foi possível enviar a solicitação.');next.disabled=false;prev.disabled=false;next.textContent='Enviar solicitação';}finally{submitting=false;}
  });
  fetch('/api/public/diagnostics/config',{credentials:'same-origin'}).then(response=>response.ok?response.json():null).then(config=>{if(!config)return;const identity=config.identity||{};if(identity.headline)document.querySelector('#campaignTitle').textContent=identity.headline;if(identity.ctaText)document.querySelector('.hero-actions .button-primary').textContent=identity.ctaText;if(identity.subheadline)document.querySelector('.hero-lede').textContent=identity.subheadline;if(identity.privacyText)document.querySelector('#privacyCopy').textContent=identity.privacyText;if(Array.isArray(identity.steps)&&identity.steps.length===3)document.querySelectorAll('#campaignSteps article p').forEach((node,index)=>node.textContent=identity.steps[index]);if(config.financing?.active){const note=document.querySelector('.hero-note');note.textContent=`${config.financing.conditionsText} Consulte a equipe para entender as condições.`;}}).catch(()=>{});
  showStep(1);
})();
