# Supplier Hub

## Supplier ingestion (Etapa 9)

```text
Authorized CSV/API
  -> SupplierAdapter
  -> ImportBatch + ImportItem (staging)
  -> validate / normalize
  -> review / dry-run / diff
  -> explicit transactional publish
  -> SupplierOffer or SupplierKitOffer
  -> ProcurementEngine
```

Upload never publishes by itself. Staging is excluded from procurement, unknown prices never become zero, missing SKUs do not delete catalog data, and the five existing suppliers remain without fictitious commercial offers. The API foundation uses environment credentials only and does not implement scraping.

## Separação de conceitos

O catálogo técnico e a condição comercial são entidades diferentes:

```text
Product
  equipamento normalizado: fabricante, modelo, categoria e especificações

SupplierProduct
  como um fornecedor identifica aquele produto: SKU, nome e URL

SupplierOffer
  captura comercial do produto: preço, estoque, prazo, validade e data
```

Para kits, a mesma separação é mantida:

```text
Kit
  composição técnica interna

SupplierKit
  kit interno relacionado ao SKU de um fornecedor

SupplierKitOffer
  captura comercial do kit
```

## Fornecedores preparados

O seed DEV prepara registros para:

- BelEnergy
- Aldo Solar
- PHB
- HELTE
- Solfácil

Todos ficam com `integrationType=manual`. Isso representa uma origem controlada de desenvolvimento, não uma integração real.

## Arquitetura de integração

A aplicação ainda não executa sincronização externa. A fronteira de domínio está pronta para receber adapters independentes:

```text
SupplierAdapter
      |
      +-- AldoAdapter
      +-- BelEnergyAdapter
      +-- PHBAdapter
      +-- HelteAdapter
      +-- SolfacilAdapter
```

Nenhuma credencial, API key, scraping ou regra específica de fornecedor foi adicionada nesta etapa.

## Fluxo atual

```text
Product
   -> SupplierProduct
   -> SupplierOffer
   -> PriceHistory

Kit + KitItem
   -> SupplierKit
   -> SupplierKitOffer
   -> PriceHistory
```

O `KitService` e o `CatalogService` são serviços de domínio/persistência. As rotas administrativas apenas autenticam, autorizam e delegam a eles.

## Limites desta etapa

Ainda não há matching de kits, score de fornecedor, procurement, frete, estoque nacional, preço real ou sincronização com fornecedores. Essas responsabilidades ficam para etapas posteriores.
