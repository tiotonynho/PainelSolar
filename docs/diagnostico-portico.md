# Campanha de diagnóstico energético

## Fluxo e rotas

- Landing pública: `/portico/diagnostico`.
- Configuração pública sem dados pessoais: `GET /api/public/diagnostics/config`.
- Envio público: `POST /api/public/diagnostics`, com chave de idempotência, UTM permitida e anexo opcional.
- Painel autenticado: menu **Diagnósticos**, com paginação, busca, filtros, detalhe, revisão, atribuição, pendências, estudo e conversão.
- API administrativa: `/api/admin/diagnostics`, `/study`, `/convert`, `/attachment` e `/config`.

## Persistência e componentes reaproveitados

`migrations/005_energy_diagnostic.sql` adiciona as tabelas de configuração, diagnóstico, anexo privado e histórico sem alterar tabelas legadas. Os anexos ficam em `diagnostic-attachments` dentro do `dataDir`, fora do banco e sem rota pública.

O estudo chama `SolarSizingEngine`; quando tensão e dados comerciais estão disponíveis, também chama `KitMatchingEngine`, `ProcurementEngine` e `ProposalPricingService`. Dados informados, estimados e confirmados são marcados separadamente. Sem kWh, HSP, ligação, tarifa ou dados comerciais confiáveis, o estudo permanece parcial e registra pendências.

## Recebimento e revisão

1. A equipe entra no painel autenticado e filtra os diagnósticos.
2. Confere os dados originais, anexo e pendências; correções ficam em uma camada separada.
3. Gera ou recalcula o estudo e registra observações.
4. Converte em proposta somente após fornecer os dados técnicos e preço necessários ao fluxo existente.
5. A conversão cria uma proposta vinculada, mas mantém o diagnóstico como `PROPOSAL_GENERATED`; só uma ação posterior e explícita pode marcar `PROPOSAL_SENT`.

## Campanha e financiamento

A configuração fica em **Configurações → Configuração do diagnóstico**. O padrão público é `Consulte opções de financiamento para o seu projeto.`. A divulgação detalhada só aparece com parceiro, condições, primeiro vencimento, período válido e validação administrativa preenchidos. Não há cálculo de parcela, CET ou aprovação de crédito.

## Verificação

- `node --test` passou com 99 testes.
- `node --check` passou em todos os JavaScript do projeto.
- Smoke test local retornou HTTP 200 para landing, CSS, JS e configuração pública.
- Não há `package.json`, script de lint ou pipeline de build neste repositório; por isso essas etapas não estavam disponíveis.

## Pendências para produção

Confirmar cidades/período da campanha, identidade/textos finais, fonte regional de HSP e parâmetros de tarifa, catálogo/ofertas/frete/estoque, configuração comercial, responsável por revisar os estudos, retenção/backup do `dataDir` e condições reais do parceiro financeiro. OCR, notificações por e-mail/WhatsApp e publicação não fazem parte desta entrega.
