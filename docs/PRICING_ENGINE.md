# Pricing Engine

## Objetivo

`pricing-engine.js` transforma custos internos conhecidos em um resultado comercial estruturado. Ele não escolhe fornecedor nem kit e não substitui o fluxo legado da tela sem uma migração explícita.

```text
SolarSizingEngine
  -> KitMatchingEngine
  -> ProcurementEngine / AcquisitionCost
  -> PricingEngine
  -> Proposal
```

O módulo é puro: não acessa DOM, HTTP, SQLite, `window` ou `document`.

## Auditoria da regra legada

A regra existente está em `app.js`, nas funções `percentageRate`, `selectedAdditionalServices`, `investmentBreakdown` e `calculate`. Para uma proposta de sistema:

```text
kitCost = Number(data.kitCost) || 0
storageCost = systemType === "hybrid" ? Number(data.batteryCost) || 0 : 0
serviceCost = Σ(max(Number(quantity) || 0, 0) × max(Number(unitValue) || 0, 0))
marginCost = kitCost × (Number(margin) || 0) / 100
installationCost = kitCost × (Number(installationRate) || 0) / 100
engineeringCost = kitCost × (Number(engineeringRate) || 0) / 100
taxCost = kitCost × (Number(taxRate) || 0) / 100

investment = kitCost
           + marginCost
           + installationCost
           + engineeringCost
           + taxCost
           + storageCost
           + serviceCost
```

Em orçamento somente de serviços, `kitCost`, `storageCost` e as parcelas percentuais ficam em zero; somente os serviços selecionados compõem o investimento.

O campo visual `margin` é matematicamente um **markup sobre o kit**, não margem bruta. A base dos percentuais legados é somente `kitCost`; não há no legado frete, custo de equipamento separado, comissão, margem-alvo, desconto ou floor price.

O modo `LEGACY` do engine preserva essa ordem e normaliza os resultados monetários para centavos. Os cenários representativos ficam em `tests/fixtures/pricing/fixtures.json`.

## Contrato

```js
const result = calculatePricing({
  mode: 'STANDARD',
  equipmentCost: 15000,       // R$; campos com sufixo Cents também são aceitos
  freightCost: 800,
  installationCost: 3500,
  engineeringCost: 800,
  additionalServices: [{code: 'SERVICE_A', cost: 400}],
  markupRate: 0.20,
  taxRate: 0.08,
  taxBase: 'DIRECT_COST'
});
```

Percentuais do modo `STANDARD` são decimais (`0.20` = 20%). Valores terminados em `Cents` já são centavos. No resultado, todos os campos monetários são inteiros em centavos; taxas e margens permanecem decimais.

O modo de compatibilidade recebe os campos legados (`kitCost`, `margin`, `installationRate`, `engineeringRate`, `taxRate`) ou `legacyRates` em decimal:

```js
calculatePricing({
  mode: 'LEGACY',
  kitCost: 5200,
  margin: 49,
  installationRate: 23.08,
  engineeringRate: 12,
  taxRate: 0
});
```

## Breakdown

O retorno contém:

```text
costs.equipment
costs.freight
costs.installation
costs.engineering
costs.additionalServices
costs.storage
costs.directCost

commercial.markupAmount
commercial.taxBase / taxAmount
commercial.commissionBase / commissionAmount
commercial.grossProfit / grossMarginRate

price.preDiscountPrice
price.discountAmount
price.customerPrice
price.floorPrice
```

`directCost` soma equipamento, frete conhecido, instalação, engenharia, serviços e armazenamento. Frete omitido pode ser `NOT_APPLICABLE`; frete explicitamente desconhecido nunca vira zero.

## Markup, margem, impostos e comissão

O modo `STANDARD` aceita exatamente um método de preço:

```text
markup:
  preço base = directCost × (1 + markupRate)

target margin:
  preço base = directCost / (1 - targetMarginRate)
```

Quando o método é `targetMarginRate`, o resultado também informa a margem bruta observada. Não há percentual comercial padrão inventado pelo módulo.

Impostos e comissão exigem base explícita quando a taxa é maior que zero. Bases suportadas nesta etapa são `DIRECT_COST` e `PRICE_BEFORE_TAX`; imposto também pode usar `CUSTOMER_PRICE`, resolvendo o valor sobre o preço antes do imposto. O modo legado usa explicitamente `LEGACY_KIT_COST` para reproduzir o comportamento atual.

## Dados incompletos e revisão

O engine não fabrica certeza. Entre os avisos possíveis estão:

```text
FREIGHT_UNKNOWN
TAX_CONFIGURATION_MISSING
COMMISSION_CONFIGURATION_MISSING
PRICE_BELOW_FLOOR
MARGIN_BELOW_TARGET
MINIMUM_MARGIN_BELOW_CONFIG
DISCOUNT_EXCEEDS_PRICE
```

Se faltar custo obrigatório, método de preço, frete exigido ou configuração de imposto/comissão, `customerPrice` fica `null`, `pricingComplete` fica `false` e `requiresReview` fica `true`. O floor price não altera silenciosamente o valor; uma venda abaixo dele é retornada com `PRICE_BELOW_FLOOR` e revisão.

## Precisão monetária

`money.js` converte valores para centavos, soma inteiros seguros e arredonda a aplicação de taxas somente na borda monetária. Isso evita o erro clássico `0.1 + 0.2 !== 0.3`. Valores negativos, `NaN`, `Infinity` e números além da precisão segura são rejeitados.

## Integração com propostas

O `app.js` chama o modo `LEGACY` ou `STANDARD` conforme a escolha da proposta. No modo STANDARD, o custo manual do equipamento é combinado com a configuração comercial ativa carregada do servidor. Se o bundle do PricingEngine não estiver disponível, o cálculo LEGACY original permanece como fallback. A equivalência foi verificada antes da integração; nenhuma proposta existente passou a exigir novos campos.

No backend, `proposal-pricing-service.js` é a fronteira única entre proposta, configuração e engine. A precedência é:

```text
override explícito da proposta
        ↓
CommercialConfig ativa
        ↓
LEGACY somente para propostas sem modo STANDARD
```

Uma proposta STANDARD sem custo de equipamento, configuração ativa ou dados obrigatórios não é publicada como proposta comercial: retorna `pricingComplete=false`, `requiresReview=true` e exige revisão explícita.

## Snapshot e repricing

Ao criar a proposta, o servidor persiste `customerPrice`, `pricingMode`, `commercialConfigVersion` e `pricingSnapshot` dentro de `records.body`. O snapshot contém custos, bases, taxas, valores calculados, avisos e timestamp em centavos quando monetário.

Alterar ou ativar uma CommercialConfig não recalcula propostas. O repricing é uma operação administrativa explícita:

```text
POST /api/records/:id/pricing
```

Somente propostas `pending` podem ser recalculadas. Propostas aceitas, preparadas ou assinadas são protegidas; uma nova revisão comercial deverá ser criada em etapa futura.

## Integração com Procurement — Etapa 8

`ProposalPricingService` recebe `pricingSource=PROCUREMENT` e um `ProcurementResult`. O mapping é explícito:

```text
bestOption.equipmentPrice → equipmentCost
bestOption.freightCost    → freightCost
```

O PricingEngine não recebe o objeto de procurement nem conhece fornecedor. Se a decisão automática for bloqueada, a proposta fica com `pricingComplete=false`, `customerPrice=null`, `requiresReview=true` e os códigos em `pricingSnapshot.procurementDecision.blockingReasons`. Uma seleção manual autorizada pode prosseguir quando os dados monetários necessários estão completos, preservando a revisão e o motivo do override.

O `pricingSnapshot` inclui `pricingSource`, `selectionMode` e, somente internamente, `procurementSnapshot`. Alterações posteriores em ofertas não mudam o snapshot existente; refresh/repricing são ações explícitas.

## Compatibilidade e segurança

O `app.js` agora chama o modo `LEGACY` através de um adaptador pequeno, preservando os mesmos campos e o mesmo fluxo visual. Se o bundle do PricingEngine não estiver disponível, o cálculo original permanece como fallback. A equivalência foi verificada antes da integração; nenhuma proposta existente passou a exigir novos campos.

O endpoint público de proposta em `server.js` usa uma lista explícita de campos apresentados ao cliente. Custos de equipamento, frete, fornecedor, lucro, margens internas, `supplierScore` e `procurementScore` não são incluídos nessa resposta.

Não foram incluídos preços comerciais fictícios no banco principal. Os valores comerciais usados pelos testes são somente fixtures em memória/arquivo de teste.
