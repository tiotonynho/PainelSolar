CREATE TABLE kits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  nominal_power_wp REAL NOT NULL CHECK(nominal_power_wp>0),
  phase_type TEXT NOT NULL CHECK(phase_type IN ('MONOPHASIC','BIPHASIC','TRIPHASIC','FLEXIBLE')),
  voltage TEXT NOT NULL,
  roof_type TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE kit_items (
  id TEXT PRIMARY KEY,
  kit_id TEXT NOT NULL REFERENCES kits(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK(quantity>0),
  role TEXT NOT NULL CHECK(role IN ('MODULE','INVERTER','MICROINVERTER','STRUCTURE','PROTECTION','CABLE','CONNECTOR','BATTERY','ACCESSORY','OTHER')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(kit_id,product_id,role)
);

CREATE TABLE supplier_kits (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  kit_id TEXT NOT NULL REFERENCES kits(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  supplier_sku TEXT NOT NULL,
  supplier_name TEXT,
  supplier_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  last_sync_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(supplier_id,supplier_sku)
);

CREATE TABLE supplier_kit_offers (
  id TEXT PRIMARY KEY,
  supplier_kit_id TEXT NOT NULL REFERENCES supplier_kits(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  price REAL CHECK(price IS NULL OR price>=0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK(length(currency)=3),
  stock_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(stock_status IN ('AVAILABLE','LOW_STOCK','OUT_OF_STOCK','UNKNOWN')),
  stock_quantity INTEGER CHECK(stock_quantity IS NULL OR stock_quantity>=0),
  lead_time_days INTEGER CHECK(lead_time_days IS NULL OR lead_time_days>=0),
  valid_until INTEGER,
  captured_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX kits_phase_active ON kits(phase_type,active);
CREATE INDEX kit_items_kit ON kit_items(kit_id);
CREATE INDEX kit_items_product ON kit_items(product_id);
CREATE INDEX supplier_kits_supplier ON supplier_kits(supplier_id);
CREATE INDEX supplier_kits_kit ON supplier_kits(kit_id);
CREATE INDEX supplier_kit_offers_kit_capture ON supplier_kit_offers(supplier_kit_id,captured_at DESC);

CREATE TABLE price_history_new (
  id TEXT PRIMARY KEY,
  supplier_product_id TEXT REFERENCES supplier_products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  supplier_kit_id TEXT REFERENCES supplier_kits(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  price REAL NOT NULL CHECK(price>=0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK(length(currency)=3),
  captured_at INTEGER NOT NULL,
  CHECK((supplier_product_id IS NOT NULL AND supplier_kit_id IS NULL) OR (supplier_product_id IS NULL AND supplier_kit_id IS NOT NULL))
);

INSERT INTO price_history_new(id,supplier_product_id,supplier_kit_id,price,currency,captured_at)
SELECT id,supplier_product_id,NULL,price,currency,captured_at FROM price_history;

DROP TABLE price_history;
ALTER TABLE price_history_new RENAME TO price_history;

CREATE INDEX price_history_product_capture ON price_history(supplier_product_id,captured_at DESC);
CREATE INDEX price_history_kit_capture ON price_history(supplier_kit_id,captured_at DESC);
