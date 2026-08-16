# Agentic Prompt Builder

Este projeto implementa uma arquitetura de "Agentic Prompting", utilizando uma pipeline de multiplos agentes LLM atraves do [OpenRouter](https://openrouter.ai).

O objetivo e pegar uma ideia bruta do usuario e passar por etapas de classificacao, clarificacao, triagem, analise, geracao e validacao ate transforma-la em um prompt otimizado e operacional.

---

## Arquitetura (Multiplos Agentes)

O motor C# (backend) orquestra chamadas de modelos com funcoes especificas. O frontend atua como a interface reativa dessas etapas:

1. Agente classificador: identifica o tipo de objetivo (imagem, video, codigo, refatoracao, copy, UI, outro).
2. Agente de ambiguidade: detecta termos ambiguos e devolve ate 2 perguntas de clarificacao.
3. Agente de triagem de complexidade: detecta quando um pedido precisa ser quebrado em sub-tarefas.
4. Agente de identificacao de papel e formato: define quem o LLM final precisa ser e como deve responder.
5. Agente analitico: encontra lacunas, riscos e gotchas tecnicos.
6. Agente gerador: monta o super prompt com base no contexto enriquecido.
7. Agente avaliador: valida o prompt e retorna uma versao refinada com score de qualidade.

O modelo usado em cada etapa e configuravel (ver [Configuracao do OpenRouter](#configuracao-do-openrouter)).

### Controles de saida

Tres opcoes moldam o prompt gerado, disponiveis tanto ao gerar quanto ao refinar:

| Controle | Opcoes | Efeito |
| --- | --- | --- |
| **Executor** | Qualquer IA, Claude Code, Jules, OpenHands, Cursor, Windsurf | Molda estrutura e nivel de autonomia do prompt para o assistente que vai executa-lo |
| **Nivel de detalhe** | Conciso, Equilibrado, Exaustivo | Ajusta a extensao e o orcamento de tokens da geracao |
| **Idioma** | Como escrevi, Portugues, Ingles | Fixa o idioma do prompt gerado |

Os perfis de executor ficam em [backend/Models/ExecutorPerfis.cs](backend/Models/ExecutorPerfis.cs). Um prompt para o Claude Code (agente de terminal que explora o repositorio) declara objetivo e criterios verificaveis em vez de passo a passo; um para o Cursor e curto, nomeia arquivos e pede diff; um para o Jules e uma especificacao completa, porque nao ha como esclarecer nada durante a execucao.

Na tela de projeto existe ainda o campo **Contexto do projeto** — stack, convencoes e restricoes que valem para todas as sub-tarefas e sao injetados em cada geracao.

---

## Tecnologias Empregadas

### Frontend

- Framework: Next.js 16 (App Router)
- Engine UI: React 19
- Linguagem: TypeScript
- Styling/Animations: Tailwind CSS e Framer Motion
- Icones: Lucide React

### Backend

- Framework: .NET 8 Web API (Minimal + Controllers hibrido)
- Linguagem: C# 12
- Integracao Externa: OpenRouter.ai
- API Spec: Swagger / OpenAPI

---

## Variaveis de Ambiente e Configuracao

### Backend: chave da API (`OpenRouterApiKey`)

O backend aceita `OpenRouterApiKey` pelas fontes padrao do ASP.NET Core. Para desenvolvimento local, use nesta ordem de preferencia:

1. Variavel de ambiente
2. `dotnet user-secrets`
3. `backend/appsettings.Development.json` local e ignorado

#### Opcao 1: variavel de ambiente

```powershell
$env:OpenRouterApiKey="sk-or-v1-SUA-CHAVE"
```

#### Opcao 2: `dotnet user-secrets`

```bash
cd backend
dotnet user-secrets set "OpenRouterApiKey" "sk-or-v1-SUA-CHAVE"
```

#### Opcao 3: arquivo local ignorado

Use [backend/appsettings.Example.json](backend/appsettings.Example.json) como referencia e crie um `backend/appsettings.Development.json` apenas no seu ambiente local.

Nao armazene segredos reais em arquivos rastreados.

### Configuracao do OpenRouter

Alem da chave, a secao `OpenRouter` permite ajustar o pipeline sem recompilar. Todos os campos sao opcionais e caem para os padroes do codigo:

| Chave | Padrao | Para que serve |
| --- | --- | --- |
| `OpenRouter:ApiKey` | — | Alternativa a `OpenRouterApiKey` na raiz |
| `OpenRouter:BaseUrl` | endpoint de chat do OpenRouter | Trocar o provedor ou apontar para um mock |
| `OpenRouter:MaxTokens` | `4096` | Teto de tokens por chamada |
| `OpenRouter:TimeoutSeconds` | `90` | Timeout de cada chamada individual |
| `OpenRouter:Models:*` | ver exemplo | Modelo de cada etapa do pipeline |
| `OpenRouter:Models:GeracaoFallback` | 4 modelos | Cadeia de fallback da etapa de geracao |
| `Cors:AllowedOrigins` | `["http://localhost:3000"]` | Origens liberadas para o frontend |

Os ids de modelo default sao modelos gratuitos do OpenRouter e mudam de disponibilidade com frequencia. Use `GET /api/modelos/testar` para confirmar quais estao respondendo antes de investigar erros no pipeline.

### Protecao das rotas

Cada POST em `/api/prompt` dispara ate 7 chamadas pagas ao OpenRouter, entao a
rota tem rate limit sempre ativo e chave de API opcional:

| Chave | Padrao | Para que serve |
| --- | --- | --- |
| `ApiProtecao:ApiKey` | vazia | Quando preenchida, exige o header `X-Api-Key` em `/api/prompt` |
| `ApiProtecao:RequisicoesPorJanela` | `20` | Teto de requisicoes por janela |
| `ApiProtecao:JanelaSegundos` | `60` | Tamanho da janela |
| `ApiProtecao:Fila` | `2` | Requisicoes excedentes que aguardam em vez de serem rejeitadas |

Sem `ApiKey` a API fica aberta e o startup registra um aviso — aceitavel em
localhost, nao em rede.

### Frontend: URL da API

Copie [frontend/.env.example](frontend/.env.example) para `frontend/.env.local` e ajuste se o backend nao estiver em `http://localhost:5117`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:5117
NEXT_PUBLIC_API_KEY=
```

`NEXT_PUBLIC_API_KEY` so e necessaria quando o backend define `ApiProtecao:ApiKey`.
Por ser `NEXT_PUBLIC_`, ela vai para o bundle e e visivel a quem abrir a pagina:
protege contra abuso casual, nao contra um usuario determinado. Para um deploy
publico, mantenha a chave no servidor atras de um route handler do Next.

---

## Como Rodar Localmente

### 1. Iniciar o backend (.NET/C#)

1. Navegue ate a pasta `backend/`.
2. Configure `OpenRouterApiKey` por uma das opcoes acima.
3. Restaure pacotes dependentes e execute o servidor de desenvolvimento:

```bash
cd backend
dotnet restore
dotnet build
dotnet run
```

_O backend expoe por padrao `http://localhost:5117`._

### 2. Iniciar o frontend (Next.js/React)

1. Em um novo terminal separado, navegue ate a pasta `frontend/`.
2. Instale as dependencias.
3. Inicie o compilador do Next:

```bash
cd frontend
npm install
npm run dev
```

_O frontend fica disponivel em `http://localhost:3000`._

---

## Verificacoes Locais

```bash
# Frontend: tipos, lint, testes e build de producao
cd frontend
npm run check

# Backend: build e testes (solution na raiz)
dotnet build assistente-super-prompt.sln
dotnet test  assistente-super-prompt.sln
```

O [CI](.github/workflows/ci.yml) roda os dois em cada pull request, mais uma
verificacao de encoding UTF-8 sobre todos os arquivos versionados.

---

## Endpoint de Self-Diagnostics

Para medir a disponibilidade dos modelos usados na pipeline, use o endpoint:

- `GET http://localhost:5117/api/modelos/testar`
- Testa exatamente os modelos configurados em `OpenRouter:Models`, um por vez, e devolve status, detalhe e latencia de cada um.
- Se `OpenRouterApiKey` nao estiver configurada, o endpoint retorna `503 Service Unavailable` com uma mensagem de configuracao ausente.

---

## Documentacao

- [AGENTS.md](AGENTS.md) — convencoes do repositorio e regra de documentos de trabalho
- [ADR-001: Modular Monolith First](docs/architecture/adr-001-modular-monolith-first.md)
- [Current State](docs/architecture/current-state.md)
- [Target State](docs/architecture/target-state.md)

Auditorias, relatorios e anotacoes ficam **locais** e nao sao versionados
(ver [AGENTS.md](AGENTS.md)). O que precisa sobreviver a eles vira issue, ADR ou
teste de regressao.

---

### Equipe de Engenharia / Maintenance

Este monorepo foca em clareza estrutural, compatibilidade incremental e evolucao segura. Pull requests devem manter alinhamento entre codigo, contratos, documentacao e testes.
