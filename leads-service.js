const crypto=require('node:crypto');

const LEAD_STATUSES=['NEW','CONTACTED','QUALIFIED','PROPOSAL_SENT','WON','LOST'];
const COMPANIES=['portico','gotex'];

function createLeadService(db){
  db.exec('CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT,city TEXT NOT NULL,state TEXT,company TEXT NOT NULL DEFAULT \'portico\',service TEXT,notes TEXT,source TEXT,protocol TEXT,created_at INTEGER NOT NULL,ip TEXT)');
  const columns=db.prepare('PRAGMA table_info(leads)').all().map(column=>column.name);
  const addColumn=(name,definition)=>{if(!columns.includes(name))db.exec('ALTER TABLE leads ADD COLUMN '+name+' '+definition);};
  addColumn('company',"TEXT NOT NULL DEFAULT 'portico'");
  addColumn('state','TEXT');
  addColumn('service','TEXT');
  addColumn('notes','TEXT');
  addColumn('source','TEXT');
  addColumn('protocol','TEXT');
  addColumn('status',"TEXT NOT NULL DEFAULT 'NEW'");
  addColumn('assigned_to','TEXT');
  addColumn('history',"TEXT NOT NULL DEFAULT '[]'");
  addColumn('updated_at','INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS leads_created ON leads(created_at)');

  const fail=(message,status=400)=>Object.assign(new Error(message),{status});
  const userName=id=>id?db.prepare('SELECT name FROM users WHERE id=?').get(id)?.name||null:null;
  const toLead=row=>({
    id:row.id,protocol:row.protocol,name:row.name,email:row.email,phone:row.phone||'',city:row.city,state:row.state||'',
    company:row.company,service:row.service||'',notes:row.notes||'',source:row.source||'',status:row.status||'NEW',
    assignedTo:row.assigned_to||null,assignedName:userName(row.assigned_to),createdAt:row.created_at,updatedAt:row.updated_at||row.created_at
  });
  const canSee=(row,user)=>user.role==='admin'||!row.assigned_to||row.assigned_to===user.id;
  const findRow=(id,user)=>{
    const row=db.prepare('SELECT * FROM leads WHERE id=?').get(id);
    if(!row||!canSee(row,user))throw fail('Lead não encontrado.',404);
    return row;
  };

  function create(data,{ip=''}={}){
    const name=String(data.name||'').trim(),email=String(data.email||'').trim().toLowerCase(),phone=String(data.phone||'').trim().slice(0,30),city=String(data.city||'').trim(),state=String(data.state||'').trim().toUpperCase(),company=String(data.company||'').trim().toLowerCase(),service=String(data.service||'').trim().slice(0,120),notes=String(data.notes||'').trim().slice(0,2000),source=String(data.source||'').trim().slice(0,120);
    if(!COMPANIES.includes(company))throw fail('Selecione uma empresa válida para o atendimento.');
    if(data.privacyAccepted!==undefined&&data.privacyAccepted!==true)throw fail('Confirme a finalidade do uso dos dados.');
    if(state&&state!=='OUTRO'&&!/^[A-Z]{2}$/.test(state))throw fail('Informe uma UF válida.');
    if(name.length<2||name.length>120||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!city||city.length>120)throw fail('Informe nome, e-mail e cidade válidos.');
    const id=crypto.randomUUID(),protocol=(company==='gotex'?'GT':'PS')+'-'+new Date().getFullYear()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase(),now=Date.now();
    db.prepare("INSERT INTO leads(id,name,email,phone,city,state,company,service,notes,source,protocol,created_at,ip,status,history,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'NEW','[]',?)").run(id,name,email,phone,city,state||null,company,service||null,notes||null,source,protocol,now,ip,now);
    return {id,protocol};
  }

  function list(user,{status,company,q,page,pageSize}={}){
    const where=[],params=[];
    if(user.role!=='admin'){where.push('(assigned_to IS NULL OR assigned_to=?)');params.push(user.id);}
    if(status){
      if(status==='OPEN')where.push("status NOT IN ('WON','LOST')");
      else if(LEAD_STATUSES.includes(status)){where.push('status=?');params.push(status);}
    }
    if(company&&COMPANIES.includes(company)){where.push('company=?');params.push(company);}
    if(q){const term='%'+String(q).trim().slice(0,120)+'%';where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR protocol LIKE ? OR city LIKE ?)');params.push(term,term,term,term,term);}
    const clause=where.length?' WHERE '+where.join(' AND '):'';
    const size=Math.min(50,Math.max(1,Number(pageSize)||10)),current=Math.max(1,Number(page)||1);
    const total=db.prepare('SELECT COUNT(*) AS total FROM leads'+clause).get(...params).total;
    const rows=db.prepare('SELECT * FROM leads'+clause+' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...params,size,(current-1)*size);
    const visibility=user.role==='admin'?'':' AND (assigned_to IS NULL OR assigned_to=?)';
    const newCount=db.prepare("SELECT COUNT(*) AS total FROM leads WHERE status='NEW'"+visibility).get(...(user.role==='admin'?[]:[user.id])).total;
    return {items:rows.map(toLead),total,page:current,pageSize:size,newCount};
  }

  function get(id,user){
    const row=findRow(id,user),lead=toLead(row);
    lead.history=JSON.parse(row.history||'[]');
    return lead;
  }

  function update(id,user,data={}){
    const row=findRow(id,user),history=JSON.parse(row.history||'[]'),now=Date.now();
    let status=row.status||'NEW',assignedTo=row.assigned_to||null;
    const entry={date:new Date(now).toISOString(),actorId:user.id,actorName:user.name};
    if(data.status!==undefined){
      if(!LEAD_STATUSES.includes(data.status))throw fail('Situação inválida.');
      if(data.status!==status){entry.status={from:status,to:data.status};status=data.status;}
    }
    if(data.assignedTo!==undefined){
      const target=data.assignedTo||null;
      if(user.role!=='admin'&&target!==user.id)throw fail('Vendedores só podem assumir o lead para si.',403);
      if(user.role!=='admin'&&assignedTo&&assignedTo!==user.id)throw fail('Este lead já tem responsável.',409);
      if(target&&!db.prepare('SELECT id FROM users WHERE id=?').get(target))throw fail('Responsável não encontrado.');
      if(target!==assignedTo){entry.assignedTo={from:assignedTo,to:target,name:userName(target)};assignedTo=target;}
    }
    if(data.note!==undefined){
      const note=String(data.note||'').trim();
      if(note.length>2000)throw fail('A anotação deve ter até 2000 caracteres.');
      if(note)entry.note=note;
    }
    if(entry.status||entry.assignedTo||entry.note)history.push(entry);
    db.prepare('UPDATE leads SET status=?,assigned_to=?,history=?,updated_at=? WHERE id=?').run(status,assignedTo,JSON.stringify(history),now,id);
    return get(id,{role:'admin'});
  }

  return {create,list,get,update};
}

module.exports={createLeadService,LEAD_STATUSES};
