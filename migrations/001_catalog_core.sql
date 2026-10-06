CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  integration_type TEXT NOT NULL DEFAULT 'manual' CHECK(integration_type IN ('api','b2b','json','xml','feed','csv','excel','structured_import','authorized_automation','scraping','manual')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('MODULE','INVERTER','MICROINVERTER','STRUCTURE','PROTECTION','CABLE','CONNECTOR','BATTERY','ACCESSORY')),
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  description TEXT,
  specifications_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(category,manufacturer,model)
);

CREATE TABLE supplier_products (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  product_id TEXT NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  supplier_sku TEXT NOT NULL,
  supplier_name TEXT,
  supplier_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  last_sync_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(supplier_id,supplier_sku)
);

CREATE TABLE supplier_offers (
  id TEXT PRIMARY KEY,
  supplier_product_id TEXT NOT NULL REFERENCES supplier_products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  price REAL CHECK(price IS NULL OR price>=0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK(length(currency)=3),
  stock_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(stock_status IN ('IN_STOCK','OUT_OF_STOCK','PRE_ORDER','UNKNOWN')),
  stock_quantity INTEGER CHECK(stock_quantity IS NULL OR stock_quantity>=0),
  lead_time_days INTEGER CHECK(lead_time_days IS NULL OR lead_time_days>=0),
  valid_until INTEGER,
  captured_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE price_history (
  id TEXT PRIMARY KEY,
  supplier_product_id TEXT NOT NULL REFERENCES supplier_products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  price REAL NOT NULL CHECK(price>=0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK(length(currency)=3),
  captured_at INTEGER NOT NULL
);

CREATE INDEX supplier_products_supplier ON supplier_products(supplier_id);
CREATE INDEX supplier_products_product ON supplier_products(product_id);
CREATE INDEX supplier_offers_product_capture ON supplier_offers(supplier_product_id,captured_at DESC);
CREATE INDEX price_history_product_capture ON price_history(supplier_product_id,captured_at DESC);
CREATE INDEX products_category_active ON products(category,active);
