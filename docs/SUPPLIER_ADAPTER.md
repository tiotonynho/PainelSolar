# Supplier Adapter

The ingestion boundary translates an authorized supplier source into normalized data. Adapters do not know PricingEngine, ProcurementEngine, KitMatchingEngine or ProposalPricingService.

## Contract

```text
fetchCatalog(source)
fetchOffers(source)
normalizeProduct(record)
normalizeOffer(record)
validateProduct(record)
validateOffer(record)
```

`CsvSupplierAdapter` implements the first development source. `ApiSupplierAdapter` is the foundation for official APIs: it supports a base URL, environment-based credentials, timeout, bounded retry for transient HTTP failures and response mapping. It does not connect to a real supplier yet.

Supported integration types are `MANUAL`, `CSV` and `API`. HTML scraping, browser automation and portal credentials are intentionally out of scope.

## Normalized boundary

```text
authorized source
  -> SupplierAdapter
  -> normalized product/offer record
  -> SupplierImportItem staging
  -> explicit review and publish
```

Credentials must remain in the environment or a secret store. Raw payloads, logs and Git must not contain tokens.
