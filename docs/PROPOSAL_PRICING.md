# Proposal Pricing — Etapa 8

## Fluxo

```text
SolarSizingEngine
      ↓
KitMatchingEngine
      ↓ ProcurementResult.bestOption
ProposalPricingService
      ↓
PricingEngine
      ↓
Proposal.customerPrice + pricingSnapshot
```

O `ProposalPricingService` é a única camada que aplica uma fonte de aquisição à proposta. O `PricingEngine` continua recebendo apenas custos e parâmetros comerciais; ele não conhece fornecedor, oferta ou score.

## Fontes

| `pricingSource` | Uso |
| --- | --- |
| `LEGACY` | preserva o cálculo histórico e propostas antigas |
| `MANUAL` | usa `equipmentCost`/`freightCost` informados pelo usuário autorizado |
| `PROCUREMENT` | usa explicitamente `ProcurementResult.bestOption` ou alternativa selecionada |

Não há troca silenciosa entre as fontes.

## Decisão automática

`canAutoPriceFromProcurement()` bloqueia o uso automático quando não houver melhor opção, preço válido, fornecedor/kit ativos, oferta vigente, match técnico válido, estoque `AVAILABLE` ou frete conhecido quando exigido. Retorna `blockingReasons`, `warnings`, `canAutoPrice` e `requiresReview`.

`LOW_STOCK`, `STOCK_UNKNOWN`, `OUT_OF_STOCK`, frete desconhecido e score de revisão não são convertidos em zero ou em certeza comercial.

## Mapping

```text
bestOption.equipmentPrice → PricingEngine.equipmentCost
bestOption.freightCost    → PricingEngine.freightCost
```

Instalação, engenharia, imposto, comissão e markup/margem continuam vindo da proposta ou do `CommercialConfig`.

## Seleção manual

`selectionMode=AUTO` usa `bestOption`. `selectionMode=MANUAL` pode selecionar uma alternativa por `supplierKitOfferId`, mas substituir a melhor opção exige `overrideReason`. O snapshot registra o modo, o override, o motivo, a oferta e o momento da seleção.

## Snapshot e imutabilidade

`proposal.pricingSnapshot` guarda a formação do preço. Para procurement, `procurementSnapshot` inclui kit, fornecedor, oferta, custo do equipamento, frete, estoque, prazo, score, seleção e motivos de revisão. O snapshot é interno e não é incluído no endpoint público.

Refresh e repricing são operações explícitas:

```text
POST /api/records/:id/procurement  → atualiza procurementReview, não muda preço
POST /api/records/:id/pricing       → recalcula e cria histórico
```

Ambas ficam bloqueadas para propostas aceitas, assinadas ou contratadas.

## Segurança

O endpoint público usa whitelist de campos. Custos, frete interno, fornecedor, scores e snapshots de procurement permanecem fora da resposta pública e do contrato do cliente.
