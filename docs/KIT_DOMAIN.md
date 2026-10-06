# Kit Domain

## Modelo

```text
Supplier
    |
    +---- SupplierKit
              |
              +---- SupplierKitOffer
              |
              v
             Kit
              |
              +---- KitItem ---- Product
```

### Kit

Representa uma composição técnica reutilizável, independente de fornecedor.

Campos:

```text
id
name
slug
nominalPowerWp
phaseType          MONOPHASIC | BIPHASIC | TRIPHASIC | FLEXIBLE
voltage            texto, permitindo mais de uma tensão
roofType
description
active
createdAt
updatedAt
```

Kits são criados como rascunho (`active=false`) por padrão. Um kit ativo deve possuir pelo menos um `KitItem`.

### KitItem

Relaciona um produto normalizado à composição:

```text
id
kitId
productId
quantity
role
createdAt
updatedAt
```

Roles aceitos:

```text
MODULE, INVERTER, MICROINVERTER, STRUCTURE, PROTECTION,
CABLE, CONNECTOR, BATTERY, ACCESSORY, OTHER
```

Existe uma constraint única para `kitId + productId + role`. Quantidade deve ser um inteiro maior que zero, e o produto precisa existir no Catalog Core.

### SupplierKit

Relaciona um kit interno à identificação comercial de um fornecedor:

```text
id
supplierId
kitId
supplierSku
supplierName
supplierUrl
active
lastSyncAt
createdAt
updatedAt
```

Um mesmo kit interno pode possuir vários `SupplierKit`, inclusive um por fornecedor.

### SupplierKitOffer

Representa uma captura comercial do `SupplierKit`:

```text
id
supplierKitId
price
currency
stockStatus       AVAILABLE | LOW_STOCK | OUT_OF_STOCK | UNKNOWN
stockQuantity
leadTimeDays
validUntil
capturedAt
createdAt
updatedAt
```

Preço pode ser nulo quando uma fonte informa disponibilidade sem preço. Nenhum preço é criado pelo seed DEV.

## Potência DC

`calculateDcPower()` considera somente itens com `role=MODULE` e lê `powerWp` das especificações do produto:

```text
calculatedModulePowerWp = soma(powerWp do módulo × quantity)
```

Exemplo:

```text
13 × 625 W = 8125 Wp
```

`validateKit()` retorna:

```text
valid
errors
warnings
nominalPowerWp
calculatedModulePowerWp
powerDiverges
```

Divergência entre potência nominal e calculada gera warning; o domínio não corrige silenciosamente nenhum valor.

## Serviço

`KitService` fornece:

```text
createKit()
updateKit()
addKitItem()
removeKitItem()
getKit()
listKits()
calculateDcPower()
validateKit()
createSupplierKit()
createSupplierKitOffer()
updateSupplierKitOffer()
```

`getKit()` retorna o kit, itens com seus produtos, validação, potência calculada, `SupplierKit` relacionados e suas ofertas.

## Rotas administrativas

Todas exigem sessão autenticada com perfil `admin`:

```text
GET    /api/admin/kits
GET    /api/admin/kits/:id
POST   /api/admin/kits
PUT    /api/admin/kits/:id
POST   /api/admin/kits/:id/items
DELETE /api/admin/kits/:id/items/:itemId
POST   /api/admin/kits/:id/supplier-kits
PUT    /api/admin/supplier-kits/:id
POST   /api/admin/supplier-kits/:id/offers
PUT    /api/admin/supplier-kit-offers/:id
```

Não existe endpoint público de kits.

## Seed DEV

O seed cria, de forma idempotente:

```text
DEV Kit 4.88 kWp
  8 × DEV Module 610W
  1 × DEV Inverter 5kW

DEV Kit 8.125 kWp
  13 × DEV Module 625W
  1 × DEV Inverter 8kW
```

Os kits usam somente produtos `DEV` e não possuem `SupplierKitOffer` ou preço comercial.

## Fora do escopo

Matching, procurement, score, pricing novo, scraping, frete, checkout, pagamento e integrações reais não fazem parte deste domínio.
