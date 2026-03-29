# Agentic Prompt Builder

![Banner Agentic Prompt Builder](https://raw.githubusercontent.com/OpenRouter/OpenRouter/main/assets/readme-banner.png)

Este projeto implementa uma arquitetura senior de "Agentic Prompting", utilizando uma pipeline de multiplos agentes LLM atraves do [OpenRouter](https://openrouter.ai).

O objetivo e pegar uma ideia bruta do usuario e passar por etapas de classificacao, clarificacao, triagem, analise, geracao e validacao ate transforma-la em um prompt otimizado e operacional.

---

## Arquitetura (Multiplos Agentes)

O motor C# (backend) orquestra chamadas de modelos com funcoes especificas. O frontend atua como a interface reativa dessas etapas:

1. Agente de triagem de complexidade: detecta quando um pedido precisa ser quebrado em sub-tarefas.
2. Agente de identificacao de papel e formato: define quem o LLM final precisa ser e como deve responder.
3. Agente analitico: encontra lacunas, riscos e gotchas tecnicos.
4. Agente gerador: monta o super prompt com base no contexto enriquecido.
5. Agente avaliador: valida o prompt e retorna uma versao refinada com score de qualidade.

---

## Tecnologias Empregadas

### Frontend

- Framework: Next.js (App Router)
- Engine UI: React
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

### Backend (`OpenRouterApiKey`)

O backend aceita `OpenRouterApiKey` pelas fontes padrao do ASP.NET Core. Para desenvolvimento local, use nesta ordem de preferencia:

1. Variavel de ambiente
2. `dotnet user-secrets`
3. `backend/appsettings.Development.json` local e ignorado

### Opcao 1: variavel de ambiente

```powershell
$env:OpenRouterApiKey="sk-or-v1-SUA-CHAVE"
```

### Opcao 2: `dotnet user-secrets`

```bash
cd backend
dotnet user-secrets set "OpenRouterApiKey" "sk-or-v1-SUA-CHAVE"
```

### Opcao 3: arquivo local ignorado

Use [backend/appsettings.Example.json](backend/appsettings.Example.json) como referencia e crie um `backend/appsettings.Development.json` apenas no seu ambiente local:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "OpenRouterApiKey": "sk-or-v1-SUA-CHAVE"
}
```

Nao armazene segredos reais em arquivos rastreados. `GeminiApiKey` nao e usada pelo backend atual e nao deve fazer parte do setup local.

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

## Endpoint de Self-Diagnostics

Para medir a disponibilidade dos modelos usados na pipeline, use o endpoint:

- `GET http://localhost:5117/api/modelos/testar`
- Se `OpenRouterApiKey` nao estiver configurada, o endpoint retorna `503 Service Unavailable` com uma mensagem de configuracao ausente.

---

### Equipe de Engenharia / Maintenance

Este monorepo foca em clareza estrutural, compatibilidade incremental e evolucao segura. Pull requests devem manter alinhamento entre codigo, contratos, documentacao e testes.
