# SolarSizingEngine

## Objetivo

`solar-sizing-engine.js` é um módulo de domínio puro, sem dependências de DOM, `window`, HTTP ou SQLite. Ele foi extraído da função `dimensioningEstimate()` do `app.js` preservando as fórmulas e arredondamentos existentes.

O módulo funciona em Node.js via `require()` e no navegador via `window.SolarSizingEngine`.

## Entrada

Forma principal:

```json
{
  "monthlyConsumptions": [820, 790, 810, 850, 900, 940, 880, 860, 830, 810, 800, 850],
  "connectionType": "BIPHASIC",
  "hsp": 4.8,
  "performanceRatio": 0.8,
  "modulePowerWp": 625,
  "monthlyHspProfile": [5.18, 5.61, 5.09, 5.19, 4.82, 4.66, 4.98, 5.70, 5.38, 5.33, 4.94, 5.13]
}
```

Também é aceita a forma curta `monthlyConsumptionKwh` para uma entrada escalar. Um histórico possui de 1 a 12 valores; valores ausentes não são preenchidos artificialmente e a média usa somente os valores recebidos.

`monthlyHspProfile`, quando informado, deve conter exatamente 12 valores positivos. Quando omitido, usa o perfil que já era padrão no sistema.

## Saída

```json
{
  "monthlyConsumptions": [],
  "averageConsumptionKwh": 0,
  "connectionType": "BIPHASIC",
  "availabilityConsumptionKwh": 50,
  "compensableConsumptionKwh": 0,
  "hsp": 4.8,
  "performanceRatio": 0.8,
  "monthlyHspProfile": [],
  "referenceHsp": 5.1675,
  "requiredDcPowerWp": 0,
  "modulePowerWp": 625,
  "moduleCount": 1,
  "installedDcPowerWp": 625,
  "monthlyGenerationKwh": [],
  "estimatedMonthlyGenerationKwh": 0,
  "estimatedAnnualGenerationKwh": 0
}
```

Os campos de potência são `Wp`, geração/consumo são `kWh`, HSP é `kWh/m²/dia` e `performanceRatio` é decimal entre 0 e 1.

## Fórmulas atuais preservadas

### Média de consumo

Para os 12 campos atuais:

```text
averageConsumptionKwh = soma(monthlyConsumptions) / quantidade de valores recebidos
```

No formulário atual, a quantidade é 12.

### Disponibilidade

O formulário legado utiliza os valores `30`, `50` e `100` no campo `connection`. O engine normaliza também os nomes técnicos:

```text
MONOPHASIC = 30 kWh/mês
BIPHASIC   = 50 kWh/mês
TRIPHASIC  = 100 kWh/mês
```

Esses valores representam exatamente o comportamento anterior do sistema. Não foram introduzidas regras tarifárias novas.

Também é possível informar `availabilityConsumptionKwh` explicitamente; isso é necessário para `FLEXIBLE`.

### Consumo compensável

```text
compensableConsumptionKwh = max(averageConsumptionKwh - availabilityConsumptionKwh, 0)
```

### Potência DC necessária

O código legado calculava primeiro em kWp:

```text
requiredKwp = compensableConsumptionKwh / (hsp × 30.4 × performanceRatio)
```

O engine expõe o mesmo resultado em Wp:

```text
requiredDcPowerWp = compensableConsumptionKwh
                    / (hsp × 30.4 × performanceRatio)
                    × 1000
```

`30.4` dias por mês é uma constante preservada do código atual.

### Quantidade de módulos

```text
moduleCount = max(1, ceil(requiredDcPowerWp / modulePowerWp))
```

O mínimo histórico de um módulo é preservado inclusive quando o consumo compensável é zero.

### Potência instalada

```text
installedDcPowerWp = moduleCount × modulePowerWp
```

Esse campo é compatível com `Kit.calculatedModulePowerWp` da ETAPA 2.

### Geração mensal

O sistema mantém um perfil mensal HSP e calcula sua média de referência:

```text
referenceHsp = soma(monthlyHspProfile) / 12
```

Para cada mês:

```text
monthlyGenerationKwh = monthlyHsp / referenceHsp
                       × hsp
                       × 30.4
                       × performanceRatio
                       × installedDcPowerWp / 1000
```

### Geração anual

```text
estimatedAnnualGenerationKwh = soma(monthlyGenerationKwh)
```

Não foram adicionados sombreamento, orientação, inclinação, clipping, perdas detalhadas, degradação ou bifacialidade.

## Validação

O cálculo estrito rejeita:

- consumo negativo, `NaN`, `Infinity`, strings ou array vazio;
- mais de 12 consumos;
- HSP menor ou igual a zero;
- performance ratio menor ou igual a zero ou maior que 1;
- potência de módulo menor ou igual a zero;
- perfil mensal HSP diferente de 12 valores ou com valor não positivo;
- tipo de ligação desconhecido;
- `FLEXIBLE` sem disponibilidade explícita.

As falhas usam `SizingValidationError` com `code=SIZING_VALIDATION` e lista de `errors`. O motor nunca retorna `NaN` silenciosamente.

## Integração legada

Antes, `app.js` calculava média, disponibilidade, potência, módulos e geração diretamente dentro de `dimensioningEstimate()`, usando estado global e valores do formulário.

Agora:

```text
FormData / activeMonthlyHsp
          |
          v
app.js: dimensioningEstimate (adaptador de nomes)
          |
          v
SolarSizingEngine.calculateSizing()
          |
          v
resultado canônico + aliases legados para calculate()/preview
```

Enquanto o usuário edita um campo inválido, o adaptador usa `emptySizingResult()` para manter o preview visual estável. Na geração da proposta, a validação HTML e a validação estrita do engine devem estar válidas.

O HSP continua sendo buscado por `server.js`/Open-Meteo/NASA POWER e entregue ao motor. O engine não conhece geocoding nem APIs externas.

## Regressão

Os fixtures em `tests/fixtures/solar-sizing/fixtures.json` registram 10 cenários representativos: baixo, médio, alto, monofásico, bifásico, trifásico, potência de módulo diferente, HSP diferente, performance diferente e fronteira de consumo zero.

Cada cenário é comparado com uma implementação- oráculo equivalente à fórmula anterior, incluindo os 12 valores de geração mensal e a geração anual.
