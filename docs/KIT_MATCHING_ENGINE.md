# Kit Matching Engine

## Objetivo

O `Kit Matching Engine` é a ponte entre a demanda calculada pelo `SolarSizingEngine` e os kits técnicos normalizados pelo `Kit Domain`.

```text
SolarSizingEngine
        ↓
SystemRequirements
        ↓
KitMatchingEngine
        ↓
CompatibleKits
```

O engine responde somente se um kit pode atender tecnicamente à demanda. Ele não acessa preços, ofertas, histórico comercial, fornecedores, frete, estoque ou margem.

## Entrada

```js
{
  requiredDcPowerWp: 7900,
  installedDcPowerWp: 8125,
  modulePowerWp: 625,
  moduleCount: 13,
  connectionType: 'BIPHASIC',
  voltage: 220
}
```

`requiredDcPowerWp` e `connectionType` são obrigatórios. Os demais dados são preservados no contrato quando disponíveis. A tensão pode ser número ou texto, por exemplo `220` ou `127/220 V`.

Tipos de conexão aceitos:

```text
MONOPHASIC
BIPHASIC
TRIPHASIC
FLEXIBLE
```

Os aliases legados e nomes acentuados são normalizados pelo mesmo mecanismo do `SolarSizingEngine`.

## Kit avaliado

O engine recebe kits completos, com `items` e `product` em cada item. A integridade é recalculada usando `KitCore.validateKit()`.

Para potência, a fonte de verdade é a soma dos módulos:

```text
calculatedModulePowerWp = Σ(product.specifications.powerWp × item.quantity)
```

`nominalPowerWp` é mantido como dado descritivo e não substitui a potência calculada.

Quando os valores divergem, o candidato recebe a razão `NOMINAL_POWER_DIVERGENCE` e as advertências de validação são retornadas em `validationWarnings`. A divergência não é corrigida silenciosamente.

Um kit ativo sem módulo calculável é considerado inválido para matching, mesmo que a validação genérica do domínio tenha apenas emitido um warning de composição.

## Algoritmo

O processamento ocorre em duas fases.

### 1. Hard filters

Na ordem atual:

1. `Kit.active === true`;
2. integridade do kit válida;
3. fase compatível;
4. tensão conhecida e compatível;
5. potência dentro da faixa configurada.

Possíveis rejeições:

```text
KIT_INACTIVE
KIT_INVALID
POWER_TOO_LOW
POWER_TOO_HIGH
CONNECTION_TYPE_MISMATCH
VOLTAGE_MISMATCH
VOLTAGE_UNKNOWN
```

Quando a tensão da demanda ou do kit está ausente, o resultado é `VOLTAGE_UNKNOWN`. O engine não assume compatibilidade silenciosamente.

`FLEXIBLE` é compatível com qualquer tipo de conexão normalizado. Essa compatibilidade é registrada como `CONNECTION_TYPE_FLEXIBLE`, em vez de ser apresentada como correspondência exata.

### 2. Ranking

Para um candidato aprovado:

```text
powerDeviationWp = kitPowerWp - requiredDcPowerWp
powerDeviationPercent = powerDeviationWp / requiredDcPowerWp × 100
```

As classificações usam o desvio absoluto:

```text
EXACT       ≤ exactMatchTolerance
GOOD        ≤ goodMatchTolerance
ACCEPTABLE  acima de goodMatchTolerance
```

O score técnico é calculado somente com:

```text
proximidade de potência
compatibilidade de conexão
compatibilidade de tensão
```

Ordenação:

```text
technicalScore DESC
abs(powerDeviationWp) ASC
kitId ASC
```

## Configuração inicial

Os parâmetros estão centralizados em `matching-config.js`:

```js
{
  minPowerRatio: 0.90,
  maxPowerRatio: 1.20,
  exactMatchTolerance: 0.05,
  goodMatchTolerance: 0.10,
  weights: {
    powerProximity: 0.70,
    connectionCompatibility: 0.20,
    voltageCompatibility: 0.10
  }
}
```

Os valores `0.90` e `1.20` são uma configuração inicial conservadora para desenvolvimento, não uma norma técnica nem uma decisão definitiva de engenharia. Eles existem para permitir ajuste posterior sem alteração do algoritmo.

O score de potência é 100 no ponto exato e decresce proporcionalmente ao desvio absoluto. A configuração também mantém scores nomeados para conexão exata, conexão flexível e tensão compatível.

## Saída

```js
{
  requirements: {
    requiredDcPowerWp: 7900,
    installedDcPowerWp: 8125,
    modulePowerWp: 625,
    moduleCount: 13,
    connectionType: 'BIPHASIC',
    voltage: 220
  },
  matches: [
    {
      kitId: 'KIT-8125',
      kitName: 'Kit 8.125 kWp',
      kitPowerWp: 8125,
      powerDeviationWp: 225,
      powerDeviationPercent: 2.8481,
      technicalScore: 98,
      classification: 'EXACT',
      reasons: [
        'POWER_WITHIN_TARGET',
        'CONNECTION_TYPE_MATCH',
        'VOLTAGE_MATCH'
      ],
      validationWarnings: []
    }
  ],
  rejected: [],
  evaluatedCount: 1
}
```

O retorno não contém preço, oferta ou fornecedor. O resultado não é persistido; ele é calculado sob demanda.

## Observabilidade

`matchKits()` aceita um logger opcional para não acoplar o domínio a uma implementação de logs:

```text
MATCH_STARTED
MATCH_COMPLETED
NO_COMPATIBLE_KITS
INVALID_REQUIREMENTS
```

O payload de log contém somente contagens, motivos e requisitos técnicos; não contém dados pessoais.

## Performance e integração

O engine é puro e não consulta SQLite. Ele espera objetos `Kit` já hidratados com `KitItem` e `Product`, portanto não cria N+1 queries durante o matching.

Para esse fluxo, `KitService.listKitsForMatching()` carrega kits, itens e produtos em uma consulta, sem carregar `SupplierKit`, ofertas ou histórico comercial. O `listKits()` geral continua disponível para consultas administrativas completas.

## Limites desta etapa

Não fazem parte do matching:

- preço;
- `SupplierKitOffer`;
- `SupplierOffer`;
- `PriceHistory`;
- fornecedor;
- estoque;
- frete;
- prazo;
- margem;
- seleção de compra.

Esses critérios pertencem ao futuro `ProcurementEngine`.
