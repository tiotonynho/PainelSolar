(function(root){
  const clone=value=>JSON.parse(JSON.stringify(value));
  const currency=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
  const decimal=value=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(value);
  function accept(proposal, acceptance, id){
    const serviceQuote=proposal?.quoteType==='services'||proposal?.servicesQuote===true;
    if(!proposal || !proposal.clientName || !Number.isFinite(proposal.investment))throw new Error('Gere uma proposta completa antes de registrar o aceite.');
    if(!serviceQuote&&(!proposal.moduleBrand || !proposal.moduleModel || !proposal.inverterBrand || !proposal.inverterModel))throw new Error('Gere uma proposta completa antes de registrar o aceite.');
    if(serviceQuote&&!services(proposal))throw new Error('Informe ao menos um serviço antes de registrar o aceite.');
    const numericKeys=serviceQuote?['investment']:['investment','installedKwp','annualGeneration','annualSavings','modulePower','modules','inverterPower','inverterQuantity'];
    for(const key of numericKeys){
      if(!Number.isFinite(Number(proposal[key]))||Number(proposal[key])<0)throw new Error('Os dados técnicos da proposta são inválidos.');
    }
    for(const key of ['name','document','date','channel','evidence'])if(!acceptance[key]?.trim())throw new Error('Preencha todos os dados do aceite.');
    if(!acceptance.confirmed)throw new Error('Confirme o recebimento do aceite do cliente.');
    const date=new Date(acceptance.date);
    if(!Number.isFinite(date.getTime()) || date.getTime()>Date.now())throw new Error('A data do aceite deve ser válida e não pode estar no futuro.');
    return {id,status:'accepted',acceptedAt:new Date().toISOString(),acceptance:clone(acceptance),proposal:clone(proposal),contract:null};
  }
  function equipment(p){
    if(p.quoteType==='services'||p.servicesQuote===true)return 'Serviços técnicos fotovoltaicos';
    let text=`${p.modules} módulos ${p.moduleBrand} ${p.moduleModel} de ${p.modulePower} W e ${p.inverterQuantity} inversor(es) ${p.inverterBrand} ${p.inverterModel} de ${decimal(p.inverterPower)} kW por unidade`;
    if(p.hybrid)text+=`, com ${p.batteryQuantity} bateria(s) ${p.batteryBrand} ${p.batteryModel}, totalizando ${decimal(p.storageCapacity)} kWh nominais`;
    return text;
  }
  function services(p){
    const list=Array.isArray(p.additionalServices)?p.additionalServices:[];
    const summary=list
      .filter(item=>item&&item.label)
      .map(item=>`${item.label}: ${decimal(Number(item.quantity)||0)} x ${currency(Number(item.unitValue)||0)} = ${currency(Number(item.total)||0)}`)
      .join('; ');
    const notes=typeof p.serviceNotes==='string'&&p.serviceNotes.trim()?`Observações: ${p.serviceNotes.trim()}`:'';
    return [summary,notes].filter(Boolean).join('. ');
  }
  function generate(record, details, template){
    if(!record?.acceptance?.confirmed)throw new Error('É necessário registrar o aceite antes de gerar o contrato.');
    const p=record.proposal;
    const serviceText=services(p);
    const tokens={
      partes:`Pelo presente instrumento particular, ${details.company}, sob CNPJ nº ${details.companyDocument}, estabelecida à ${details.companyAddress}, representada por ${details.representative}, responsável técnico ${details.engineer}, aqui denominada CONTRATADA, e ${p.clientName}, sob CPF/CNPJ nº ${record.acceptance.document}, com endereço à ${p.address}, ${p.city}/${p.state}, aqui denominado(a) CONTRATANTE, têm entre si justo e contratado o seguinte:`,
      distribuidora:details.utility,equipamentos:equipment(p),estrutura:details.structure,valor:currency(p.investment),
      potencia:decimal(p.installedKwp)+' kWp',geracao:decimal(p.annualGeneration)+' kWh',pagamento:details.payment,
      adicionais:details.additional||serviceText||'Nenhum serviço adicional.',prazo:details.deadline,medicao:details.meter,foro:details.jurisdiction,
      cidade:p.city,data:new Intl.DateTimeFormat('pt-BR',{dateStyle:'long'}).format(new Date(details.date+'T12:00:00')),
      cliente:p.clientName,empresa:details.company,testemunha1:details.witness1||'Nome e CPF: ____________________',
      testemunha2:details.witness2||'Nome e CPF: ____________________',proposta:record.id,
      hibrido:p.hybrid?`Complemento do sistema híbrido: armazenamento nominal de ${decimal(p.storageCapacity)} kWh, energia utilizável teórica de ${decimal(p.usableCapacity)} kWh e autonomia teórica de ${decimal(p.autonomy)} horas para carga média de ${decimal(p.backupLoad)} kW. O fornecimento durante falta de rede limita-se aos circuitos de backup definidos no projeto, sujeito à carga, estado de carga das baterias, perdas e limites dos equipamentos. Escopo dos circuitos de backup: ${details.backup}.`:''
    };
    // Replace only template tokens, never recursively interpret customer text.
    const text=template.replace(/\{\{(\w+)\}\}/g,(_,key)=>tokens[key]??'');
    const annex=[
      'Proposta: '+record.id,
      'Cliente: '+p.clientName+' - Instalação: '+p.address+', '+p.city+'/'+p.state,
      'Equipamentos: '+equipment(p),
      'Potência instalada: '+decimal(p.installedKwp)+' kWp. Geração anual estimada: '+decimal(p.annualGeneration)+' kWh.',
      'Investimento total: '+currency(p.investment)+'. Condição aceita na proposta: 80% na assinatura do contrato e 20% após a instalação.',
      'Economia anual estimada: '+currency(p.annualSavings)+'. Premissas: HSP '+p.hsp+' h/dia; performance ratio '+p.performance+'; tarifa '+currency(Number(p.tariff))+'/kWh. Estimativas sujeitas às condições da instalação.',
      'Aceite da proposta: '+record.acceptance.name+' em '+new Date(record.acceptance.date).toLocaleString('pt-BR')+'. Canal: '+record.acceptance.channel+'.'
    ];
    if(serviceText)annex.splice(3,0,'Serviços adicionais: '+serviceText+'.');
    return text+'\n\nANEXO B - RESUMO DA PROPOSTA ACEITA\n\n'+annex.join('\n\n');
  }
  const api={accept,generate,equipment,services,clone};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.ContractCore=api;
})(typeof window==='undefined'?globalThis:window);
