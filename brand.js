(()=>{
  const form=document.querySelector('#leadForm');
  if(!form)return;
  const status=document.querySelector('#formStatus');
  const button=form.querySelector('button');
  const source=new URLSearchParams(location.search).get('utm_source')||document.body.dataset.company+'-page';
  form.elements.source.value=source;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    button.disabled=true;
    status.className='form-status';
    status.textContent='Enviando seus dados…';
    try{
      const response=await fetch('/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Não foi possível enviar agora.');
      form.reset();
      form.elements.company.value=document.body.dataset.company;
      form.elements.source.value=source;
      status.textContent='Recebemos seus dados. A empresa responsável entrará em contato em breve.';
    }catch(error){status.className='form-status error';status.textContent=error.message;}
    finally{button.disabled=false;}
  });
})();
