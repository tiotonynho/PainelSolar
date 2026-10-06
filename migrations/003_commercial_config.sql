CREATE TABLE IF NOT EXISTS commercial_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL UNIQUE CHECK(version>0),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  pricing_mode TEXT NOT NULL CHECK(pricing_mode IN ('LEGACY','STANDARD')),
  default_installation_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(default_installation_cost_cents>=0),
  default_engineering_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(default_engineering_cost_cents>=0),
  default_markup_rate REAL CHECK(default_markup_rate IS NULL OR (default_markup_rate>=0 AND default_markup_rate<1)),
  default_target_margin_rate REAL CHECK(default_target_margin_rate IS NULL OR (default_target_margin_rate>=0 AND default_target_margin_rate<1)),
  default_commission_rate REAL NOT NULL DEFAULT 0 CHECK(default_commission_rate>=0 AND default_commission_rate<=1),
  default_commission_base TEXT,
  default_tax_rate REAL NOT NULL DEFAULT 0 CHECK(default_tax_rate>=0 AND default_tax_rate<=1),
  default_tax_base TEXT,
  minimum_margin_rate REAL CHECK(minimum_margin_rate IS NULL OR (minimum_margin_rate>=0 AND minimum_margin_rate<1)),
  default_freight_required INTEGER NOT NULL DEFAULT 0 CHECK(default_freight_required IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS commercial_configs_active ON commercial_configs(active,version DESC);

CREATE TABLE IF NOT EXISTS commercial_config_audit (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL REFERENCES commercial_configs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('CREATED','ACTIVATED')),
  previous_config_id TEXT,
  new_config_id TEXT NOT NULL,
  actor_id TEXT,
  created_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS commercial_config_audit_config ON commercial_config_audit(config_id,created_at DESC);
