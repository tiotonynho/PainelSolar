# Supplier Import

## Lifecycle

```text
UPLOAD
  -> RECEIVED/PARSING
  -> VALIDATING
  -> REVIEW_REQUIRED or READY_TO_PUBLISH
  -> explicit PUBLISH
  -> PUBLISHED
```

CSV upload creates `supplier_import_batches` and `supplier_import_items`. Staging is not a commercial offer. Procurement can consume only rows published into `supplier_offers` or `supplier_kit_offers`.

## Validation and normalization

The CSV parser supports comma, semicolon and tab separators, configurable column mapping, UTF-8/Latin-1/UTF-16 input, BRL and explicit currency, ISO or Brazilian dates, stock states (`AVAILABLE`, `LOW_STOCK`, `OUT_OF_STOCK`, `UNKNOWN`) and controlled decimal parsing. Ambiguous values such as `1.234` require `decimalFormat` instead of being guessed.

Required commercial data is never converted to zero. Unknown price, lead time or stock remains invalid/null/`UNKNOWN` and may block publication or automatic use.

Product matching uses `supplierId + supplierSku`, an explicit internal product ID, or an exact attribute suggestion. Attribute suggestions and unmatched rows remain reviewable; uncertain matches never create a Product automatically.

## Review, dry run and diff

`dryRun` calculates the diff without writing commercial tables. Reports include total, valid, invalid, warnings, matched, unmatched, new, updated, unchanged, price changes and stock changes. Configurable guards flag suspicious price variation and mass updates. Missing SKUs do not delete products or mark them out of stock.

## Publish and history

`publishSupplierImport` is explicit, admin-only and transactional. A failure rolls back all offer, link and history writes. Identical source content is idempotent through a supplier/source hash. Price history is added only when a price changes or is first published; a capture with the same price does not create redundant price history.

## Administrative API

```text
GET  /api/admin/suppliers
GET  /api/admin/supplier-imports
POST /api/admin/supplier-imports/preview
POST /api/admin/supplier-imports
GET  /api/admin/supplier-imports/:id
GET  /api/admin/supplier-imports/:id/diff
POST /api/admin/supplier-imports/:id/dry-run
POST /api/admin/supplier-imports/:id/publish
POST /api/admin/supplier-imports/:id/cancel
PATCH /api/admin/supplier-imports/:id/items/:itemId
```

The browser sends the CSV as JSON text for this MVP; the upload endpoint does not publish automatically. All routes require the existing admin authentication.
