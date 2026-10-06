# Arquitetura atual

## Supplier ingestion

```text
Authorized CSV/API
        -> SupplierAdapter
        -> Raw Import + Staging
        -> Validation / Normalization
        -> Review / Dry Run / Diff
        -> Explicit Transactional Publish
        -> SupplierOffer / SupplierKitOffer / PriceHistory
        -> ProcurementEngine
```

`SupplierImportService` is the boundary between external data and the commercial catalog. It handles lifecycle, matching assistance, anomaly guards, idempotency and audit. It does not choose a supplier, calculate sale price or alter proposals. Only published rows are visible to procurement.

## Visão geral

O projeto continua sendo um monólito modular pequeno em Node.js nativo, com frontend JavaScript sem framework e SQLite. A evolução é incremental; não foi introduzido `src/` nem framework novo.

```text
Browser
  index.html
  app.js
    SolarSizingEngine
  contracts.js
  auth-ui.js
  cliente.js

Módulos de domínio
  solar-sizing-engine.js
  kit-matching-engine.js
  matching-config.js
  procurement-engine.js
  supplier-score.js
  procurement-config.js
  freight-quote.js
  pricing-engine.js
  pricing-config.js
  money.js
  commercial-config-service.js
  proposal-pricing-service.js

Node HTTP
  server.js
    auth.js
    catalog-service.js
    kit-service.js
    contract-core.js
    database/migrations

SQLite
  records, users, sessions, solar_hsp_cache
  suppliers, products, supplier_products, supplier_offers
  price_history, kits, kit_items, supplier_kits, supplier_kit_offers
  commercial_configs, commercial_config_audit
```

## Domínios

### Solar

`solar-sizing-engine.js` contém somente cálculo e validação de dimensionamento. Recebe consumo, conexão, HSP, performance, potência do módulo e perfil mensal. Não busca localização e não acessa persistência.

### Catalog e Supplier Hub

`catalog-core.js` e `catalog-service.js` normalizam produtos, fornecedores, vínculos e ofertas de equipamentos. `kit-core.js` e `kit-service.js` normalizam composição de kits, relações de fornecedor e ofertas de kits.

### Propostas e contratos

`app.js` continua responsável pela experiência de orçamento e apresentação. `server.js`, `contract-core.js` e `contracts.js` preservam o fluxo de propostas, aceite e contratos da baseline.

## Fluxo de dimensionamento

```text
Formulário
  -> app.js coleta campos
  -> SolarSizingEngine.calculateSizing()
  -> app.js adapta nomes legados e renderiza preview/proposta
  -> contracts.js compartilha a proposta existente
```

O fluxo técnico de seleção agora possui uma segunda fronteira, sem persistir recomendações:

```text
SolarSizingEngine
  -> SystemRequirements
  -> KitMatchingEngine
  -> CompatibleKits
  -> ProcurementEngine
  -> Best Acquisition Option
  -> PricingEngine
  -> Customer Price
  -> Proposal
```

O fluxo de HSP permanece separado:

```text
Cidade/UF
  -> server.js + Open-Meteo/NASA POWER
  -> activeMonthlyHsp
  -> SolarSizingEngine
```

## Compatibilidade

- Os scripts de dinheiro/configuração/pricing são carregados antes de `app.js`; o adaptador de compatibilidade usa o modo `LEGACY`.
- `server.js` serve `solar-sizing-engine.js` na lista de arquivos estáticos permitidos.
- O adaptador em `app.js` preserva os nomes antigos (`modules`, `installedKwp`, `generation`, `annualGeneration`) usados pelo restante da tela.
- Nenhum campo novo é exigido para propostas existentes.
- Nenhuma rota de proposta, autenticação ou contrato foi removida.

## Procurement

`procurement-engine.js` recebe somente matches técnicos, combina-os com `SupplierKit` e `SupplierKitOffer`, calcula `landedCost`, `SupplierScore` e `procurementScore`, e retorna opções comerciais com rejeições explicáveis. Dados desconhecidos permanecem `null`/`UNKNOWN` e podem exigir revisão humana.

## Pricing

### Procurement → Pricing → Proposal

`procurement-pricing-bridge.js` formaliza a fronteira entre aquisição e preço de venda. Ele valida `ProcurementResult`, decide `canAutoPrice`, mapeia somente `equipmentPrice`/`freightCost` e constrói o snapshot interno. `proposal-pricing-service.js` aplica esse input ao PricingEngine e persiste `pricingSource`, `selectionMode`, `customerPrice` e `pricingSnapshot`. O servidor oferece refresh de procurement separado de repricing, ambos explícitos e protegidos para propostas não aceitas.

```text
ProcurementResult
      ↓
canAutoPriceFromProcurement
      ↓
ProposalPricingService
      ↓
PricingEngine
      ↓
Proposal / public whitelist
```

## CommercialConfig e proposta

```text
CommercialConfig versionada
        ↓
Proposal override + config ativa
        ↓
ProposalPricingService
        ↓
PricingEngine LEGACY ou STANDARD
        ↓
customerPrice + pricingSnapshot
        ↓
records.body
        ↓
public proposal / accepted proposal / contract
```

O endpoint público recebe somente campos de cliente, incluindo `customerPrice`; custos, margens, comissão, fornecedor e snapshot permanecem internos. A geração do contrato lê o preço persistido da proposta e não chama o PricingEngine.

`pricing-engine.js` recebe custo de aquisição/execução e devolve breakdown monetário, preço do cliente, avisos e necessidade de revisão. O modo `LEGACY` reproduz a fórmula histórica de `app.js`; o modo `STANDARD` separa markup, margem-alvo, imposto, comissão, desconto e floor price.

O `PricingEngine` pode consumir a melhor opção de aquisição:

```text
requiredDcPowerWp
installedDcPowerWp
modulePowerWp
moduleCount
connectionType
voltage (quando disponível)
```

O `KitMatchingEngine` aplica filtros técnicos e não acessa preço. O `ProcurementEngine` trata somente aquisição. O `PricingEngine` trata a transformação do custo interno em preço de venda, sem selecionar fornecedor. A tela usa o modo `LEGACY` durante a transição e mantém o cálculo anterior como fallback de carregamento.
