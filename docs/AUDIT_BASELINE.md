# PainelSolar — Auditoria baseline

Data da auditoria: 2026-10-06
Branch: `main`
Commit auditado: `81270ef` (`Adiciona fluxo de orcamento de servicos`)
Origem observada no repositório: SolarPro / Pórtico Solar Energy

## STATUS ATUAL

O repositório contém um MVP funcional de orçamentos fotovoltaicos, autenticação de equipe, compartilhamento de proposta por link, aceite do cliente e preparação/assinatura eletrônica simples de contrato.

- Stack: Node.js nativo, JavaScript sem framework, HTML/CSS e SQLite nativo (`node:sqlite`).
- Requisitos documentados: Node.js 24 ou superior.
- Não existe `package.json`, lockfile, dependência npm ou script npm. O README declara que não há dependências para instalar.
- O servidor é iniciado com `node server.js` e, por padrão, escuta em `127.0.0.1:8080`.
- A verificação de disponibilidade realizada durante a auditoria retornou `GET / => 200` e `GET /api/auth/status => 200`.
- O worktree estava limpo antes da criação deste documento. Nenhuma funcionalidade foi alterada nesta etapa.
- Snapshot local do banco em `.data/contracts.sqlite`: 1 usuário, 1 sessão, 0 registros de proposta e 1 item no cache de HSP. Os dados operacionais ficam fora do Git.

## ARQUITETURA

### Organização atual

O sistema é um monólito modular pequeno, sem camada de aplicação ou domínio formal:

```text
Browser
  index.html
    app.js              formulário, dimensionamento e proposta visual
    contracts.js         contratos, clientes derivados e compartilhamento
    auth-ui.js           bloqueio de autenticação, equipe e conta
    api-client.js        cliente HTTP comum
    contract-core.js     validação/geração de contrato
    contract-template.js modelo textual do contrato
    cliente.js           tela pública do cliente

Node.js
  server.js              HTTP, arquivos estáticos, API, SQLite e HSP
  auth.js                usuários, sessões, senha e autorização
  contract-core.js       núcleo compartilhado por servidor e navegador

SQLite
  .data/contracts.sqlite
```

### Responsabilidades por arquivo

- `server.js`: cria o servidor HTTP, inicializa o SQLite, serve uma lista fixa de arquivos, valida origem em requisições mutáveis, expõe autenticação, propostas, HSP, aceite, contratos e exclusão/arquivamento.
- `auth.js`: cria as tabelas de usuários/sessões, usa `scrypt` com salt, emite cookie HttpOnly/SameSite e aplica os perfis `admin` e `seller`.
- `app.js`: concentra estado da tela e regras de dimensionamento, geração, economia, payback, armazenamento híbrido e preço. O cálculo acontece no navegador.
- `contracts.js`: cria dinamicamente a área de contratos, lista registros, gera links, prepara versões contratuais e deriva a tela de clientes a partir das propostas.
- `contract-core.js`: valida o mínimo necessário para aceite, produz texto contratual a partir do template e monta o resumo da proposta.
- `cliente.js`: consulta o endpoint público pelo token do fragmento da URL e registra aceite ou assinatura.
- `localities.js`: catálogo estático de municípios/UFs, com aproximadamente 208 KB.

Não existe atualmente uma camada de `Catalog`, `Supplier`, `Kit`, `Procurement` ou `Pricing` independente. O contrato é o único núcleo compartilhado já extraído.

### Integrações externas

O endpoint autenticado `/api/solar/hsp` consulta:

1. Open-Meteo Geocoding para localizar a cidade;
2. NASA POWER `ALLSKY_SFC_SW_DWN` para a climatologia solar.

O resultado mensal/anual é armazenado em `solar_hsp_cache`. A interface mantém fallback manual quando a consulta falha. Não há adapter/provider abstraction para essa integração.

## BANCO DE DADOS

O banco padrão é `.data/contracts.sqlite`, aberto diretamente por `server.js` com `DatabaseSync`. O modo WAL é habilitado.

### Schema observado

```text
records
  id TEXT PRIMARY KEY
  token TEXT UNIQUE
  body TEXT NOT NULL
  owner_id TEXT

users
  id TEXT PRIMARY KEY
  name TEXT NOT NULL
  email TEXT NOT NULL UNIQUE
  password_hash TEXT NOT NULL
  role TEXT CHECK(role IN ('admin','seller'))
  active INTEGER NOT NULL DEFAULT 1
  must_change_password INTEGER NOT NULL DEFAULT 0

sessions
  token_hash TEXT PRIMARY KEY
  user_id TEXT NOT NULL
  expires_at INTEGER NOT NULL

solar_hsp_cache
  key TEXT PRIMARY KEY
  body TEXT NOT NULL
  updated_at INTEGER NOT NULL
```

Índices adicionais observados: `records_owner` e `sessions_user`, além dos índices automáticos de chaves únicas/primárias.

### Persistência de propostas

Uma proposta inteira, aceite, contrato, histórico de revisões e assinatura ficam serializados em `records.body`. O token público bruto não é salvo: o servidor salva o SHA-256 do token e entrega um token aleatório de 32 bytes em Base64URL.

O acesso a registros é filtrado por `owner_id`, exceto para administradores. A configuração da primeira conta migra registros legados sem proprietário para o primeiro administrador.

### Lacunas de banco

- Não existe diretório de migrations nem tabela de versão de schema. A inicialização usa `CREATE TABLE IF NOT EXISTS` e uma alteração condicional para `owner_id`.
- Não há foreign keys declaradas entre sessões, usuários e registros, nem configuração explícita de `PRAGMA foreign_keys=ON`.
- Não há entidades normalizadas para produtos, fornecedores, ofertas, histórico de preço/estoque, kits ou itens de kit.
- Não há índices, constraints ou versionamento para o conteúdo JSON de `records.body`.
- Não há trilha de auditoria comercial estruturada para alterações de preço, margem, kit ou proposta.
- O uso direto de `node:sqlite` mantém o MVP simples, mas acopla a camada de persistência ao runtime atual e exige uma migração explícita para PostgreSQL no futuro.

## FLUXO DE DIMENSIONAMENTO

O fluxo é iniciado em `app.js` depois do preenchimento do formulário. O histórico possui 12 valores mensais e a média é `soma / 12`.

Para uma proposta de sistema:

1. `connection` é lido como disponibilidade fixa no formulário (`30`, `50` ou `100`) e subtraído da média mensal.
2. O consumo alvo é `max(média mensal - disponibilidade, 0)`.
3. A potência DC requerida é calculada como:

   ```text
   requiredKwp = targetMonthly / (hsp * 30.4 * performance)
   ```

4. A quantidade de módulos é arredondada para cima:

   ```text
   modules = ceil(requiredKwp * 1000 / modulePower)
   ```

5. A potência instalada é `modules * modulePower / 1000`.
6. A geração mensal usa o perfil mensal ativo, normalizado pela média do perfil padrão, e a geração anual é a soma dos 12 meses.
7. O perfil HSP pode ser o padrão local ou o retorno Open-Meteo/NASA; o usuário também pode editar o HSP manualmente.

Para sistema híbrido, o código adicionalmente calcula:

```text
storageCapacity = batteryCapacity * batteryQuantity
usableCapacity = storageCapacity * batteryDod / 100
autonomy = usableCapacity / backupLoad
```

Essa autonomia é explicitamente teórica e não considera perdas. A compatibilidade elétrica, MPPT, tensão e circuito de backup não são validados pelo código.

Propostas de serviço pulam o dimensionamento técnico e zeram módulos, potência, geração e economia.

Não existe hoje um `SolarSizingEngine` independente, contrato de entrada/saída versionado ou teste unitário direto das fórmulas. A lógica depende do DOM, dos campos do formulário e de estado global do navegador (`activeMonthlyHsp`, `hspSourceLabel`).

## FLUXO DE PRECIFICAÇÃO

O preço também é calculado no navegador, em `app.js`, usando valores digitados manualmente:

```text
kitCost
+ kitCost * margin / 100
+ kitCost * installationRate / 100
+ kitCost * engineeringRate / 100
+ kitCost * taxRate / 100
+ batteryCost                  (somente híbrido)
+ additionalServicesTotal
= investment
```

O payback simples é `investment / annualSavings`. A economia anual é limitada por `min(generationAnnual, targetMonthly * 12) * tariff`.

Estado atual da precificação:

- `kitCost` é um valor manual; não existe oferta de fornecedor nem composição de kit.
- Não existem frete, prazo, disponibilidade, confiabilidade, garantia, comissão ou custos de aquisição separados.
- `energyInflation` é coletado e obrigatório, mas não participa do cálculo atual.
- Não existe `PricingEngine` independente.
- O servidor recebe a proposta já calculada e faz apenas validações mínimas em `ContractCore.accept`; ele não recalcula o preço nem a geração.
- O custo do kit fica no registro interno, mas o endpoint público filtra `kitCost` antes de responder ao cliente.

## FLUXO DE PROPOSTA

```text
Escolha de tipo
  -> formulário de cliente/endereço
  -> 12 meses de consumo
  -> parâmetros técnicos/comerciais manuais
  -> calculate() no navegador
  -> buildProposal() e renderização visual
  -> evento proposalbuilt
  -> contracts.js guarda cópia temporária
  -> POST /api/records após “Gerar link do cliente”
  -> records.body com status pending e validade de 3 dias
  -> link /cliente.html#<token>
```

### Aceite e contrato

1. O cliente acessa o endpoint público pelo token.
2. O servidor retorna uma visão filtrada da proposta, sem o conteúdo interno completo.
3. O cliente envia nome, documento, e-mail e confirmação; o servidor valida o formato e o documento do contratante quando presente.
4. O registro muda para `accepted` e recebe evento de auditoria com data, IP, navegador e hash da proposta.
5. Um usuário autenticado prepara a minuta após o aceite. Cada publicação incrementa `revision`, guarda a versão anterior em `history` e calcula SHA-256 do texto.
6. O cliente assina pelo mesmo link, informando novamente identidade autodeclarada e o hash da versão apresentada.
7. A assinatura muda o status para `signed`; versões assinadas ficam bloqueadas.

Status observados: `pending`, `accepted`, `prepared`, `signed` e `archived`.

O cadastro de clientes não é uma entidade própria: a tela agrupa propostas por documento ou nome. A tela de Configurações ainda é um placeholder, e a interface de administração existente limita-se à equipe/conta.

## TESTES

### Suíte encontrada

- `tests/api-client.test.js`: 5 testes sobre protocolo de arquivo, erros de rede/API, sessão e timeout.
- `tests/auth.test.js`: 2 testes sobre configuração inicial, isolamento, migração legada, sessões, troca de senha e desativação.
- `tests/contracts.test.js`: 4 testes sobre geração de contrato, proposta de serviços, aceite/assinatura/persistência e cache de HSP.

### Execução realizada

Os testes individuais foram executados sem alteração de código:

```text
node tests/api-client.test.js   -> 5 pass, 0 fail
node tests/auth.test.js         -> 2 pass, 0 fail
node tests/contracts.test.js    -> 4 pass, 0 fail
```

Resultado efetivo: **11 testes aprovados, 0 falhas**.

O comando documentado `node --test tests/*.test.js` foi executado, mas o runner do Node tentou criar subprocessos e falhou antes das asserções com `Error: spawn EPERM` em todos os três arquivos. O mesmo `spawn EPERM` ocorreu ao executar cada arquivo com `node --test <arquivo>`. Isso é uma limitação do ambiente de execução observado; a execução direta de cada arquivo usando `node <arquivo>` passou integralmente.

Não há `npm test` porque o repositório não possui `package.json`. Também não foi executado `npm install`, pois não há manifesto/dependências para instalar e o README declara explicitamente essa condição.

Não há testes para catálogo, fornecedores, ofertas, kits, matching, procurement ou pricing isolado.

## DÍVIDAS TÉCNICAS

1. **Domínio acoplado à interface:** dimensionamento e precificação vivem em `app.js` e dependem do DOM.
2. **Persistência monolítica:** proposta e contrato são JSON livre dentro de uma única tabela `records`.
3. **Sem migrations:** o schema é criado/mutado no startup, sem histórico de versões ou mecanismo de rollback.
4. **Sem validação de domínio no servidor:** campos técnicos e comerciais calculados no cliente são aceitos com validação mínima.
5. **Sem catálogo normalizado:** equipamentos são texto livre (`moduleBrand`, `moduleModel`, `inverterBrand`, etc.).
6. **Sem abstração de fornecedores:** não há interface de adapter, sincronização, importação, credenciais ou fonte de dados.
7. **Sem histórico comercial:** preço, estoque, validade e origem da oferta não são registrados.
8. **Sem kit normalizado:** o custo do kit não possui composição rastreável.
9. **Sem precificação modular:** não há componentes de frete, instalação, engenharia, impostos, comissão e margem como domínio independente.
10. **Interface administrativa incompleta:** Clientes e Configurações ainda são visões parciais/placeholders; não existe área para fornecedores, produtos, kits, ofertas ou importações.
11. **Testabilidade limitada:** não há testes unitários diretos do dimensionamento/preço; os testes de integração dependem da execução do servidor e de SQLite.
12. **Operação sem camada de observabilidade:** não há logger estruturado nem eventos de importação, matching, seleção ou precificação.
13. **Identidade e nomenclatura:** o código e o banco ainda usam `SolarPro`/`Pórtico Solar`, enquanto a evolução solicitada é `PainelSolar`; a mudança deve ser planejada para não quebrar cookies, links ou dados.

## RISCOS

- **Risco comercial:** como geração e investimento são calculados no cliente, um cliente que consiga chamar a API pode enviar valores divergentes dos valores originalmente exibidos. Antes de operação comercial ampliada, o servidor deve recalcular ou validar uma representação canônica do domínio.
- **Risco de integridade:** JSON sem schema e sem foreign keys permite registros incompletos, referências órfãs e migrações difíceis.
- **Risco de evolução:** adicionar produtos/ofertas diretamente em `records.body` perpetuaria o acoplamento e tornaria comparação histórica de preços pouco confiável.
- **Risco técnico de dimensionamento:** a escolha de módulos/inversores não verifica compatibilidade elétrica, tensão, MPPT, sobre/subdimensionamento DC/AC ou restrições de instalação.
- **Risco de integração:** HSP depende de duas APIs externas; indisponibilidade ou mudança de resposta deixa o fluxo dependente de entrada manual.
- **Risco de disponibilidade:** SQLite/WAL em disco local é adequado ao MVP, mas exige backup consistente e armazenamento persistente em publicação. Não há camada de concorrência/distribuição para escala nacional.
- **Risco de segurança e privacidade:** propostas, documentos, dados de contato, IP e navegador são persistidos; não há política de retenção, trilha de acesso administrativo ou auditoria comercial estruturada.
- **Risco jurídico/identidade:** a assinatura atual é eletrônica simples, com identidade autodeclarada e sem provedor externo, certificado, SMS ou verificação de titularidade. O próprio README registra essa limitação.
- **Risco de dados comerciais:** ainda não existem preços reais, estoque, prazo ou confiabilidade de fornecedores; nenhuma decisão de compra pode ser automatizada com o estado atual.

## RECOMENDAÇÕES

1. Preservar `server.js`, `auth.js`, `contract-core.js` e o fluxo de propostas como compatibilidade inicial; extrair domínios por composição incremental.
2. Introduzir uma camada pequena de banco com migrations transacionais e uma tabela `schema_migrations`, sem reescrever o banco legado.
3. Começar pelo domínio normalizado de fornecedores/produtos/ofertas/histórico, mantendo `records` intocado nesta etapa.
4. Definir contratos de entrada/saída para os engines antes de conectá-los à interface.
5. Manter preço e estoque como dados de oferta, não como atributos do produto técnico; permitir valores ausentes em seed de desenvolvimento para não inventar preços reais.
6. Criar validação pura e testes de domínio antes de criar UI administrativa.
7. Adicionar logs estruturados sem dados sensíveis para importação, sincronização, matching, seleção e precificação quando esses fluxos existirem.
8. Não implementar adapters reais ou scraping agora; primeiro criar a interface comum e adapters de desenvolvimento determinísticos.
9. Registrar explicitamente qualquer diferença entre o resultado atual de `app.js` e o resultado de um engine extraído.

## PLANO PARA ETAPA 1

Objetivo da próxima etapa: criar a fundação normalizada de catálogo e fornecedores, sem alterar o comportamento do orçamento/proposta existente.

### Escopo proposto

1. Criar um executor de migrations idempotente e transacional, compatível com o SQLite atual e sem usar recursos que impeçam futura migração para PostgreSQL.
2. Criar as tabelas normalizadas:

   ```text
   suppliers
   products
   supplier_products
   supplier_offers
   price_history
   ```

3. Usar constraints para slug/SKU, categorias válidas, moeda, status de estoque, chaves estrangeiras e timestamps; criar índices para fornecedor, produto, SKU e captura.
4. Manter `Product` como equipamento técnico normalizado, com especificações versionáveis; não misturar preço/estoque no produto.
5. Criar funções de domínio puras para normalização/validação, sem depender do DOM.
6. Criar seed de desenvolvimento idempotente para `BelEnergy`, `Aldo Solar`, `PHB`, `HELTE` e `Solfácil`, além de produtos explicitamente marcados como `DEV`. Não inserir preço real inventado.
7. Adicionar testes de migration, constraints, criação/atualização de oferta e preservação de `price_history`.
8. Não modificar `app.js`, as fórmulas atuais, o payload público, o fluxo de aceite ou o contrato, salvo o mínimo necessário para inicializar a nova migration sem afetá-los.

### Arquivos que provavelmente serão criados/modificados na ETAPA 1

```text
db.js ou database.js                 conexão/migrations, mantendo o legado
migrations/001_catalog_core.sql      schema de fornecedores e catálogo
catalog-core.js                      normalização e validação pura
catalog-seed.js                      seed DEV idempotente
server.js                            inicialização da migration; sem mudança de fluxo
tests/catalog.test.js                testes novos do domínio e persistência
README.md                             execução/migrations e limites do seed
```

Os nomes finais devem ser confirmados após uma inspeção pontual do estilo de módulos existente. Não está recomendado reorganizar todo o projeto para `src/` na ETAPA 1.

### Critérios de aceite da ETAPA 1

- Suíte existente continua com 11 testes aprovados.
- Migration nova pode ser aplicada em banco vazio e no `.data/contracts.sqlite` existente sem apagar ou reescrever `records`, `users`, `sessions` ou `solar_hsp_cache`.
- Fornecedor e produto podem existir sem oferta; uma oferta referencia um `SupplierProduct` válido.
- Nova captura de preço cria `price_history` e não apaga capturas anteriores.
- Seed é repetível e não cria duplicatas.
- Nenhuma credencial, token ou preço real é versionado.
- Nenhuma tela de cliente passa a receber custo interno ou dados de fornecedor automaticamente.

## CONCLUSÃO DA ETAPA 0

A auditoria não identificou necessidade de reescrever o MVP. A base atual já possui autenticação, persistência de propostas, contratos e testes funcionais, mas os domínios necessários ao Supplier Hub ainda não existem. A evolução segura é incremental: primeiro adicionar schema/migrations e o catálogo normalizado, mantendo o fluxo atual isolado até que os engines tenham equivalência testada.

Esta etapa está concluída e o trabalho deve parar aqui até autorização explícita para iniciar a ETAPA 1.
