# CommercialConfig

## Objetivo

`CommercialConfig` armazena versões dos parâmetros comerciais que alimentam o `PricingEngine` no modo `STANDARD`. A configuração não é editada destrutivamente: cada criação recebe uma nova versão e uma ativação é registrada em auditoria.

```text
CommercialConfig v1
CommercialConfig v2
CommercialConfig v3 (ativa)
```

## Campos

```text
id
name
version
active
pricingMode
defaultInstallationCostCents
defaultEngineeringCostCents
defaultMarkupRate
defaultTargetMarginRate
defaultCommissionRate
defaultCommissionBase
defaultTaxRate
defaultTaxBase
minimumMarginRate
defaultFreightRequired
createdAt
updatedAt
createdBy
```

Percentuais são armazenados como decimais: `0.20` representa 20%. Valores monetários persistidos na configuração são centavos.

Markup e margem-alvo são mutuamente exclusivos. Comissão e imposto acima de zero exigem uma base explícita suportada pelo `PricingEngine`.

## Precedência

```text
Proposal override
      ↓
CommercialConfig ativa (ou versão explicitamente selecionada no repricing)
      ↓
LEGACY somente quando a proposta não é STANDARD
```

Uma configuração não substitui valores de uma proposta existente. O snapshot salvo na proposta continua sendo a fonte histórica.

## Acesso administrativo

Rotas protegidas pelo administrador existente:

```text
GET   /api/admin/commercial-config
POST  /api/admin/commercial-config
PATCH /api/admin/commercial-config/:id/activate
GET   /api/admin/commercial-config/audit
```

Usuários autenticados podem consultar a configuração ativa em:

```text
GET /api/commercial-config/active
```

Essa resposta é interna e não é exposta no link público da proposta.

## Auditoria

`commercial_config_audit` registra:

```text
quem
quando
ação
versão anterior
nova versão
snapshot da configuração
```

Não existe operação de atualização destrutiva ou exclusão de configuração.

## Migrations e compatibilidade

`migrations/003_commercial_config.sql` cria somente as tabelas novas. Não altera `records`, usuários, contratos, catálogo, kits ou fornecedores. Propostas antigas continuam sem snapshot fabricado; quando recebidas novamente, o modo LEGACY preserva o `investment` existente se não houver entradas de precificação suficientes.
