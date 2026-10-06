# Procurement Engine e Supplier Score

## Objetivo

O `ProcurementEngine` transforma somente kits já aprovados pelo `KitMatchingEngine` em opções comerciais de aquisição.

```text
SolarSizingEngine
        ↓
KitMatchingEngine
        ↓
CompatibleKits
        ↓
ProcurementEngine
        ↓
Best Acquisition Options
```

O engine não redimensiona o sistema, não refaz matching técnico e não acessa sites ou adapters de fornecedores.

## Contrato de entrada

```js
{
  compatibleKits: [
    {
      kitId: 'KIT-8125',
      technicalScore: 96,
      classification: 'EXACT'
    }
  ],
  kits: [
    {
      id: 'KIT-8125',
      supplierKits: [
        {
          id: 'SUPPLIER-KIT-1',
          supplierId: 'SUP-1',
          active: true,
          supplier: { id: 'SUP-1', name: 'Fornecedor DEV', active: true },
          offers: []
        }
      ]
    }
  ],
  destinationPostalCode: '88000000',
  freightQuotes: [],
  supplierScores: {},
  now: 1700000000000
}
```

O catálogo de kits deve estar hidratado com `SupplierKit`, `SupplierKitOffer` e `Supplier`. Apenas os IDs presentes em `compatibleKits` são processados. Uma oferta barata de um kit ausente nessa lista não pode virar candidata.

## Filtros comerciais

## Contrato com a proposta — Etapa 8

O resultado pode ser consumido pelo `ProposalPricingService` através de `bestOption`. A ponte exige uma decisão explícita antes de precificar automaticamente:

```text
ProcurementResult.bestOption
        ↓
canAutoPriceFromProcurement()
        ↓
mapProcurementToPricingInput()
        ↓
PricingEngine
```

O ProcurementEngine não calcula preço de venda. `equipmentPrice` e `freightCost` são somente dados de aquisição. Oferta vencida, fornecedor/kit inativos, estoque desconhecido/baixo, preço inválido, frete desconhecido ou revisão pendente bloqueiam o modo automático conforme a política da proposta.

O refresh de procurement é explícito e não altera uma proposta já precificada. Uma nova precificação cria novo snapshot e histórico.

Cada oferta é avaliada por:

```text
1. fornecedor ativo;
2. SupplierKit ativo;
3. preço positivo e conhecido;
4. oferta dentro da validade;
5. estoque diferente de OUT_OF_STOCK.
```

Rejeições são retornadas com contexto:

```text
SUPPLIER_INACTIVE
SUPPLIER_KIT_INACTIVE
INVALID_PRICE
OFFER_EXPIRED
OUT_OF_STOCK
NO_VALID_OFFER
KIT_NOT_FOUND
MISSING_REQUIRED_DATA
```

`OUT_OF_STOCK` não é candidato imediatamente adquirível, mas permanece no relatório de rejeições.

## Dados desconhecidos

Desconhecido não é convertido em zero:

```js
{
  freightStatus: 'UNKNOWN',
  freightCost: null,
  landedCost: null
}
```

O mesmo princípio vale para estoque, prazo e confiabilidade. O candidato pode aparecer em `alternatives`, mas não será automaticamente escolhido quando faltarem dados críticos.

## FreightQuote

`freight-quote.js` fornece a estrutura transitória:

```js
{
  supplierId,
  supplierKitId,
  postalCode,
  cost,
  estimatedDays,
  status: 'KNOWN' | 'UNKNOWN' | 'UNAVAILABLE',
  quotedAt,
  expiresAt
}
```

Não há integração real de frete nesta etapa. O CEP é normalizado para oito dígitos, sem geocoding.

## Landed cost

O custo de aquisição é calculado somente com frete conhecido:

```text
landedCost = equipmentPrice + freightCost
```

Se o frete for `UNKNOWN` ou `UNAVAILABLE`:

```text
landedCost = null
```

Não é assumido frete grátis.

## SupplierScore

`SupplierScore` mede confiabilidade operacional, separado do `procurementScore`.

Métricas preparadas:

```text
deliveryReliability
stockAccuracy
priceConsistency
supportQuality
warrantyHandling
orderSuccessRate
```

Sem métricas internas, o retorno é:

```js
{
  status: 'UNKNOWN',
  score: null,
  warnings: ['SUPPLIER_RELIABILITY_UNKNOWN']
}
```

Nenhum fornecedor real recebe reputação inventada. Métricas podem ser fornecidas explicitamente por `supplierScores` em fixtures ou configuração administrativa futura.

## ProcurementScore

Cada critério conhecido é normalizado para `0..100`.

Para preço, frete e prazo, menor valor recebe maior pontuação relativa ao conjunto de candidatos:

```text
score = (máximo - valor) / (máximo - mínimo) × 100
```

Se todos os valores forem iguais, o score do critério é `100`.

Estoque utiliza configuração nomeada:

```text
AVAILABLE = 100
LOW_STOCK = 70
UNKNOWN   = null
```

O score final utiliza somente componentes conhecidos e renormaliza os pesos:

```text
procurementScore =
  Σ(scoreConhecido × peso)
  / Σ(pesoDosCritériosConhecidos)
```

Configuração inicial em `procurement-config.js`:

```js
weights: {
  price: 0.20,
  freight: 0.25,
  leadTime: 0.15,
  stock: 0.15,
  reliability: 0.10,
  technical: 0.15
},
closeScoreTolerance: 2
```

Esses pesos são uma configuração inicial, não uma política comercial definitiva. O frete possui peso explícito porque o ranking deve considerar custo de aquisição, não somente o preço do equipamento.

Quando duas opções automaticamente elegíveis possuem scores dentro de `closeScoreTolerance`, ambas são marcadas com `OFFERS_TOO_CLOSE` e o resultado exige revisão humana.

## Prazo e revisão humana

O retorno diferencia:

```text
supplierLeadTimeDays
freightEstimatedDays
estimatedDeliveryDays
```

`estimatedDeliveryDays` somente é calculado quando prazo do fornecedor e estimativa de frete são conhecidos.

Uma opção pode ser `bestOption` quando possuir:

```text
landedCost conhecido
estoque conhecido
supplierLeadTime conhecido
```

Confiabilidade desconhecida, estoque baixo ou outros warnings podem manter `bestOption`, mas deixam `requiresReview=true`. Se todas as opções tiverem dados críticos desconhecidos, o resultado será:

```js
{
  bestOption: null,
  requiresReview: true
}
```

## Ordenação

```text
procurementScore DESC
landedCost ASC quando ambos conhecidos
leadTimeDays ASC quando ambos conhecidos
supplierId ASC
supplierKitOfferId ASC
```

O resultado inclui `bestOption`, `alternatives`, `rejected`, `warnings` e `requiresReview`.

## Observabilidade

O engine aceita logger opcional e prepara os eventos:

```text
PROCUREMENT_STARTED
PROCUREMENT_COMPLETED
NO_VALID_OFFERS
REVIEW_REQUIRED
OFFER_REJECTED
PROCUREMENT_INVALID_INPUT
```

Os eventos não registram dados pessoais.

## Performance e persistência

O resultado não é persistido. `KitService.listKits()` fornece os dados completos para consultas administrativas; o carregamento específico de matching pode usar `listKitsForMatching()` quando não são necessárias ofertas. O ProcurementEngine trabalha em memória sobre os objetos já hidratados e não cria consultas N+1.

## Fora do escopo

- adapters reais;
- APIs de fornecedores;
- scraping;
- cotação real de frete;
- telemetria histórica de pedidos;
- PricingEngine;
- checkout;
- pagamentos.
