# Banco de dados

## Supplier ingestion

`004_supplier_ingestion.sql` adds `supplier_import_batches`, `supplier_import_items` and `supplier_import_audit`. A batch stores source, hash, lifecycle, counters, warnings and actors; items store raw data, normalized data, matching and publication state.

```text
SupplierImportBatch 1 ---- N SupplierImportItem
SupplierImportBatch 1 ---- N SupplierImportAudit
SupplierImportItem  --publish--> SupplierProduct/SupplierOffer
SupplierImportItem  --publish--> SupplierKit/SupplierKitOffer
```

Staging is not read by ProcurementEngine. Publication is explicit and transactional. Existing offers are preserved and the development seed still creates no commercial offers or prices.

## Bootstrap

O banco continua sendo SQLite em `.data/contracts.sqlite`. `db.js` abre a conexão, habilita WAL e `PRAGMA foreign_keys=ON`, cria `schema_migrations` e aplica os arquivos SQL em ordem lexicográfica dentro de transações `BEGIN IMMEDIATE`.

Migrations aplicadas:

`003_commercial_config.sql` é aplicada após o domínio de kits.

```text
001_catalog_core.sql  Supplier, Product, SupplierProduct, SupplierOffer e PriceHistory inicial
002_kit_domain.sql    Kit, KitItem, SupplierKit, SupplierKitOffer e generalização do PriceHistory
```

As migrations são aditivas e não recriam o banco legado. A migration 002 copia os registros existentes de `price_history` para a versão generalizada antes de substituir a tabela; os registros anteriores permanecem vinculados a `supplier_product_id`.

## Tabelas do domínio

```text
suppliers
products
supplier_products
supplier_offers
price_history
kits
kit_items
supplier_kits
supplier_kit_offers
commercial_configs
commercial_config_audit
```

`records`, `users`, `sessions` e `solar_hsp_cache` continuam pertencendo ao MVP de propostas/autenticação e não foram alteradas semanticamente.

## Relacionamentos

```text
Supplier 1 ---- N SupplierProduct N ---- 1 Product
SupplierProduct 1 ---- N SupplierOffer

Kit 1 ---- N KitItem N ---- 1 Product
Supplier 1 ---- N SupplierKit N ---- 1 Kit
SupplierKit 1 ---- N SupplierKitOffer

PriceHistory -> exatamente um SupplierProduct ou um SupplierKit
```

As referências do domínio usam foreign keys com `ON DELETE RESTRICT`, preservando a integridade histórica. Os índices cobrem categoria/status de produto, composição de kit, fornecedor, kit e captura temporal de ofertas/histórico.

## PriceHistory generalizado

O `PriceHistory` agora possui:

```text
id
supplier_product_id   nullable
supplier_kit_id       nullable
price
currency
captured_at
```

Uma constraint exige que exatamente uma das duas referências esteja preenchida. Assim, a mesma estrutura registra preço histórico de equipamento e de kit comercial, sem criar uma tabela de histórico duplicada.

O serviço não atualiza nem remove entradas históricas. Uma nova captura de preço cria uma nova linha; uma atualização sem alteração de preço não cria uma captura redundante.

## CommercialConfig e propostas

`003_commercial_config.sql` adiciona `commercial_configs` e `commercial_config_audit`. A migration não altera `records`; o snapshot de pricing é adicionado de forma compatível dentro do JSON da proposta.

```text
CommercialConfig 1 ---- N commercial_config_audit
records.body -> pricingMode, customerPrice, commercialConfigVersion, pricingSnapshot
```

Propostas antigas sem campos de pricing não recebem valores históricos inventados. O modo LEGACY usa `investment` existente como fallback quando necessário.

## Compatibilidade

- A primeira migration continua sendo aplicada antes da segunda em banco vazio.
- Banco existente com dados de `records`, usuários, sessões e catálogo da ETAPA 1 é preservado.
- O servidor continua inicializando as tabelas legadas depois do `openDatabase`, sem alterar o fluxo de propostas.
- O seed de desenvolvimento é executado separadamente com `node catalog-seed.js`; ele não cria ofertas nem preços comerciais.
