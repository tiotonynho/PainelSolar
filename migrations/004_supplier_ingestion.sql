CREATE TABLE supplier_import_batches (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK(source_type IN ('CSV','API')),
  file_name TEXT,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RECEIVED','PARSING','VALIDATING','REVIEW_REQUIRED','READY_TO_PUBLISH','PUBLISHED','FAILED','CANCELLED')),
  delimiter TEXT,
  decimal_format TEXT,
  mapping_json TEXT NOT NULL DEFAULT '{}',
  total_records INTEGER NOT NULL DEFAULT 0 CHECK(total_records>=0),
  valid_records INTEGER NOT NULL DEFAULT 0 CHECK(valid_records>=0),
  invalid_records INTEGER NOT NULL DEFAULT 0 CHECK(invalid_records>=0),
  warning_records INTEGER NOT NULL DEFAULT 0 CHECK(warning_records>=0),
  matched_records INTEGER NOT NULL DEFAULT 0 CHECK(matched_records>=0),
  unmatched_records INTEGER NOT NULL DEFAULT 0 CHECK(unmatched_records>=0),
  new_records INTEGER NOT NULL DEFAULT 0 CHECK(new_records>=0),
  updated_records INTEGER NOT NULL DEFAULT 0 CHECK(updated_records>=0),
  unchanged_records INTEGER NOT NULL DEFAULT 0 CHECK(unchanged_records>=0),
  price_changes INTEGER NOT NULL DEFAULT 0 CHECK(price_changes>=0),
  stock_changes INTEGER NOT NULL DEFAULT 0 CHECK(stock_changes>=0),
  errors_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  created_by TEXT,
  validated_at INTEGER,
  published_at INTEGER,
  published_by TEXT
);

CREATE UNIQUE INDEX supplier_import_batches_supplier_hash ON supplier_import_batches(supplier_id,source_hash);
CREATE INDEX supplier_import_batches_supplier_status ON supplier_import_batches(supplier_id,status,created_at DESC);

CREATE TABLE supplier_import_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES supplier_import_batches(id) ON UPDATE CASCADE ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK(row_number>0),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('PRODUCT_OFFER','KIT_OFFER')),
  external_sku TEXT,
  raw_data_json TEXT NOT NULL,
  normalized_data_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('MATCHED','UNMATCHED','INVALID','DUPLICATE','REVIEW_REQUIRED','PUBLISHED')),
  errors_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  matched_product_id TEXT REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  matched_kit_id TEXT REFERENCES kits(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  published_entity_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(batch_id,row_number)
);

CREATE INDEX supplier_import_items_batch_status ON supplier_import_items(batch_id,status,row_number);
CREATE INDEX supplier_import_items_sku ON supplier_import_items(external_sku);

CREATE TABLE supplier_import_audit (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES supplier_import_batches(id) ON UPDATE CASCADE ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_id TEXT,
  created_at INTEGER NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX supplier_import_audit_batch ON supplier_import_audit(batch_id,created_at DESC);

CREATE TABLE supplier_offers_ingestion_v4 (
  id TEXT PRIMARY KEY,
  supplier_product_id TEXT NOT NULL REFERENCES supplier_products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  price REAL CHECK(price IS NULL OR price>=0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK(length(currency)=3),
  stock_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(stock_status IN ('AVAILABLE','LOW_STOCK','OUT_OF_STOCK','UNKNOWN','IN_STOCK','PRE_ORDER')),
  stock_quantity INTEGER CHECK(stock_quantity IS NULL OR stock_quantity>=0),
  lead_time_days INTEGER CHECK(lead_time_days IS NULL OR lead_time_days>=0),
  valid_until INTEGER,
  captured_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO supplier_offers_ingestion_v4(id,supplier_product_id,price,currency,stock_status,stock_quantity,lead_time_days,valid_until,captured_at,created_at,updated_at)
SELECT id,supplier_product_id,price,currency,stock_status,stock_quantity,lead_time_days,valid_until,captured_at,created_at,updated_at FROM supplier_offers;

DROP TABLE supplier_offers;
ALTER TABLE supplier_offers_ingestion_v4 RENAME TO supplier_offers;
CREATE INDEX supplier_offers_product_capture ON supplier_offers(supplier_product_id,captured_at DESC);
