# SolarPro - MVP de orçamentos fotovoltaicos

Protótipo web baseado no modelo de proposta da Pórtico Solar Energy.

## Supplier ingestion

The platform includes a controlled supplier CSV pipeline with staging, validation, normalization, dry-run, diff, explicit publish, rollback and price history. No real supplier integration or fictitious commercial data is enabled by default.

## Como executar

Use Node.js 24 ou superior. A plataforma agora exige o servidor para autenticar as contas. Abra o endereço HTTP exibido no terminal, em vez do arquivo HTML.

```powershell
node server.js
```

Depois acesse `http://127.0.0.1:8080`. No primeiro acesso, crie a conta administradora com nome, e-mail e senha de pelo menos 10 caracteres. Não há dependências npm para instalar.

O schema inicial do Supplier Hub é aplicado automaticamente pelo servidor por meio das migrations em `migrations/`. Para criar os fornecedores, equipamentos e kits fictícios de desenvolvimento, execute `node catalog-seed.js`. O seed não cria preços ou ofertas comerciais.

## Contas e equipe

- O administrador cadastra vendedores e outros administradores pelo menu **Equipe**, informando uma senha provisória. Compartilhe as credenciais diretamente com a pessoa; a plataforma não envia e-mails.
- A primeira entrada exige a troca da senha provisória.
- Vendedores acessam apenas seus clientes, propostas compartilhadas e contratos. O administrador acessa todos os registros e gerencia as contas.
- A opção **Manter conectado** dura 30 dias. Sem ela, a sessão tem limite de 8 horas e usa cookie de sessão do navegador.
- **Minha conta** permite trocar a senha e sair. A troca de senha encerra as demais sessões. Administradores podem redefinir senhas provisórias e desativar acessos na área Equipe.
- Não há recuperação automática por e-mail. Mantenha uma segunda conta administradora para recuperação operacional.
- As senhas usam scrypt com salt individual. Os tokens de sessão são armazenados como hash no SQLite e os cookies são HttpOnly e SameSite=Strict.
- A configuração da primeira conta só é permitida por uma conexão local e com `PUBLIC_URL` ainda não definido. Configure a conta antes de publicar.
- A migração preserva o banco existente: os registros anteriores ficam vinculados à primeira conta administradora. A chave antiga em `.data/admin-key.txt` e a variável `SOLARPRO_ADMIN_PASSWORD` deixam de autenticar usuários.

O formulário de orçamento em edição continua temporário. Os registros são salvos no servidor ao gerar o link do cliente.

## O que está implementado

- Cadastro do cliente e da unidade consumidora
- Histórico de consumo de 12 meses
- Dimensionamento automático de potência e módulos
- Estimativa de geração mensal e anual
- Formação de preço baseada no modelo Excel
- PricingEngine com modo LEGACY compatível, cálculo em centavos e breakdown interno
- CommercialConfig versionada para propostas STANDARD, com snapshot de preço e repricing administrativo explícito
- Economia e payback simples
- Proposta comercial responsiva
- Impressão ou exportação para PDF pelo navegador

## Equipamentos e sistemas híbridos

Na etapa Sistema, escolha on-grid ou híbrido e informe marca, modelo, potência e quantidade de inversores. As marcas possuem sugestões e também aceitam digitação livre; os modelos são informados pelo código do fabricante, sem catálogo ou consulta automática de especificações. Informe a potência e a área do módulo conforme sua ficha técnica.

O sistema híbrido habilita marca, modelo, capacidade e quantidade de baterias, profundidade de descarga, carga média de backup e custo adicional instalado. Esse custo é somado ao investimento após as margens do kit. A autonomia teórica é calculada pela energia utilizável dividida pela carga média, sem perdas. A compatibilidade elétrica e o circuito de backup precisam de validação técnica.

A proposta inclui uma página de equipamentos e premissas. A economia é limitada ao consumo compensável informado; o armazenamento não aumenta a geração nem a economia calculada. Os campos obrigatórios são validados por etapa.

## Contratos, aceite e assinatura

1. Gere uma proposta com os equipamentos preenchidos.
2. A sessão iniciada com e-mail e senha já autoriza o uso de Contratos, sem outra chave.
3. Na proposta, clique em **Gerar link do cliente** e compartilhe o endereço. O prazo para aceite é de 3 dias.
4. O cliente acessa o link, confere a proposta e registra o aceite com nome, CPF/CNPJ e e-mail.
5. No menu Contratos, atualize a lista e abra o registro aceito. Confira os dados da contratada, instalação, pagamento, prazo, testemunhas e, no híbrido, circuitos de backup.
6. Prepare e revise a minuta. Clique em **Publicar versão para assinatura**.
7. O cliente acessa novamente o mesmo link, lê o contrato completo e confirma a assinatura eletrônica simples. As versões assinadas ficam bloqueadas para edição.
8. O contrato e o registro da assinatura podem ser impressos ou salvos como PDF.

O texto foi adaptado do PDF fornecido, com campos variáveis e anexo da proposta. Cláusulas e referências normativas do modelo original foram preservadas, sem revisão jurídica. Financiamento, ampliação e isenção de troca de medidor não são assumidos para novos projetos. As condições comerciais podem ser revisadas no texto antes de publicar; o anexo conserva as condições da proposta aceita.

Esta versão registra **assinatura do cliente por link com identidade autodeclarada**. Não verifica a titularidade do e-mail, não usa SMS, certificado digital ou provedor de assinatura, e não coleta eletronicamente assinaturas da contratada e testemunhas. Não há envio automático de mensagens: o operador compartilha o link.

O registro inclui data do servidor, IP da conexão, navegador, histórico de versões e SHA-256 do texto assinado, incluindo o anexo. O hash ajuda a conferir a integridade; os registros não constituem certificação externa. O IP registrado é o da conexão ao servidor e pode ser o do proxy.

As propostas compartilhadas e os contratos ficam no SQLite em `.data/contracts.sqlite`. A pasta `.data` está fora do Git e não é servida por HTTP. Faça backup dessa pasta com o servidor parado. O formulário de orçamento ainda é temporário.

### Disponibilizar links aos clientes

Os links locais só funcionam no computador que executa o servidor. Para acesso externo, hospede o servidor em um endereço HTTPS e configure `PUBLIC_URL` com essa origem, depois de criar a conta administradora localmente. Defina também `HOST` e `PORT` conforme a hospedagem e mantenha o banco em disco persistente. O servidor escuta apenas `127.0.0.1` por padrão. Com `PUBLIC_URL=https://...`, o cookie usa Secure.

Exemplo de configuração no PowerShell, após providenciar a hospedagem:

```powershell
$env:PUBLIC_URL = 'https://seu-dominio.example'
$env:HOST = '0.0.0.0'
$env:PORT = '8080'
node server.js
```

A publicação e a contratação de serviços externos não foram realizadas.

### Verificação

```powershell
node --test tests/*.test.js
```

Os testes verificam preenchimento do modelo, sistemas híbridos, autenticação, aceite, concorrência, revisão, bloqueio de assinatura desatualizada, imutabilidade após assinatura e persistência após reiniciar.
