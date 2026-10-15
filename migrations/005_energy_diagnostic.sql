CREATE TABLE IF NOT EXISTS campaign_diagnostic_config (
  id TEXT PRIMARY KEY CHECK(id='default'),
  identity_json TEXT NOT NULL,
  cities_json TEXT NOT NULL DEFAULT '[]',
  valid_from TEXT,
  valid_until TEXT,
  financing_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

INSERT OR IGNORE INTO campaign_diagnostic_config(
  id,identity_json,cities_json,valid_from,valid_until,financing_json,updated_at,updated_by
) VALUES (
  'default',
  '{"brandName":"Pórtico Solar Energy","headline":"Descubra quanto você pode economizar com energia solar.","subheadline":"Diagnóstico gratuito para residências e empresas, com análise preliminar baseada nos dados informados.","ctaText":"Quero meu diagnóstico gratuito","privacyText":"Usaremos seus dados somente para analisar seu consumo, entrar em contato sobre este diagnóstico e preparar uma proposta quando fizer sentido. A autorização para comunicações futuras é opcional.","steps":["Você informa os dados da conta e do imóvel.","Nossa equipe confere as premissas e prepara um estudo preliminar.","Depois da revisão, avaliamos o próximo passo com você."]}',
  '[]',NULL,NULL,
  '{"displayActive":false,"conditionsVerified":false,"partnerName":null,"conditionsText":null,"entryText":null,"termMonths":null,"graceMonths":null,"firstDueDate":null,"requiredFinancialInfo":[]}',
  strftime('%s','now') * 1000,NULL
);

CREATE TABLE IF NOT EXISTS campaign_diagnostics (
  id TEXT PRIMARY KEY,
  protocol TEXT NOT NULL UNIQUE,
  submission_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  utm_json TEXT NOT NULL DEFAULT '{}',
  contact_name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  profile TEXT NOT NULL CHECK(profile IN ('RESIDENTIAL','COMMERCIAL')),
  average_consumption_kwh REAL,
  average_bill_amount REAL,
  original_data_json TEXT NOT NULL,
  corrected_data_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('RECEIVED','DATA_PENDING','STUDY_GENERATED','IN_REVIEW','PROPOSAL_GENERATED','PROPOSAL_SENT','CLOSED')),
  pending_json TEXT NOT NULL DEFAULT '[]',
  study_json TEXT,
  notes_json TEXT NOT NULL DEFAULT '[]',
  assigned_to TEXT,
  client_record_id TEXT,
  proposal_id TEXT,
  received_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_diagnostic_attachments (
  id TEXT PRIMARY KEY,
  diagnostic_id TEXT NOT NULL REFERENCES campaign_diagnostics(id) ON UPDATE CASCADE ON DELETE CASCADE,
  storage_name TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes>0),
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_diagnostic_history (
  id TEXT PRIMARY KEY,
  diagnostic_id TEXT NOT NULL REFERENCES campaign_diagnostics(id) ON UPDATE CASCADE ON DELETE CASCADE,
  event TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS campaign_diagnostics_status_received ON campaign_diagnostics(status,received_at DESC);
CREATE INDEX IF NOT EXISTS campaign_diagnostics_profile_city ON campaign_diagnostics(profile,city,state);
CREATE INDEX IF NOT EXISTS campaign_diagnostics_assigned ON campaign_diagnostics(assigned_to,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS campaign_diagnostic_history_diagnostic ON campaign_diagnostic_history(diagnostic_id,created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_diagnostic_attachments_diagnostic ON campaign_diagnostic_attachments(diagnostic_id);
