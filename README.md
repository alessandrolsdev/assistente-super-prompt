# Agentic Prompt Builder

![Banner Agentic Prompt Builder](https://raw.githubusercontent.com/OpenRouter/OpenRouter/main/assets/readme-banner.png)

Este projeto implementa uma arquitetura **Sênior** de "Agentic Prompting", utilizando uma pipeline de Múltiplos Agentes LLM (Large Language Models) gratuitos através do [OpenRouter](https://openrouter.ai).

O objetivo é pegar uma _ideia bruta e caótica_ do usuário e passar por 4 etapas neurais até transformá-la no _Prompt Otimizado Perfeito_ que instruirá uma IA de forma profissional e inequívoca, mitigando as limitações do conhecimento e do foco comum entre as abordagens de prompts zero-shot.

---

## 🏗️ Arquitetura (Múltiplos Agentes)

O motor C# (Backend) orquestra a chamada de distintos LLMs para funções altamente específicas. O Frontend atua como a área de visualização reativa (UI) destas etapas:

1. **Agente de Triagem de Complexidade (Etapa -1)**: Detecta se o que você pediu contém _múltiplas funcionalidades disfarçadas de uma só_. Se sim, ele fragmenta e recomenda módulos menores.
2. **Agente de Identificação de Papel e Formato (Etapa 0)**: Entende _quem_ o LLM final precisa ser (ex: "Engenheiro Frontend Sênior especializado em React") e como o payload deve ser formatado.
3. **Agente Analítico (Etapa 1)**: Não visa gerar a resposta, mas atuar como o advogado do diabo, analisando deficiências e encontrando os 3 maiores "gotchas" técnicos ou de contexto da sua ideia.
4. **Agente Gerador de Super Prompt (Etapa 2)**: Responsável exclusivamente por montar e modular o template final unindo TUDO o que foi analisado antes.
5. **Agente Avaliador Sênior (Etapa 3)**: Valida os prompts gerados em Etapa 2. Fazendo loop reflexivo (se baseando em regras sintáticas estritas), ele refatora pontos fracos e entrega um "Quality Score Final" de aprovação.

---

## 💻 Tecnologias Empregadas

### Frontend

- **Framework:** Next.js 14+ (App Router)
- **Engine UI:** React 18
- **Linguagem:** TypeScript Sênior (TSDocs Integrado)
- **Styling/Animations:** Tailwind CSS & Framer Motion
- **Ícones:** Lucide React

### Backend

- **Framework:** .NET 8 Web API (Minimal + Controllers Híbrido)
- **Linguagem:** C# 12 (com XML Documentation)
- **Integração Externa:** OpenRouter.ai (modelos livres integrados, incluindo _Meta Llama 3_ e _Arcee Trinity Large_)
- **API Spec:** Swagger / OpenAPI

---

## ⚙️ Variáveis de Ambiente e Configuração

### Backend (`appsettings.Development.json`)

Crie no repositório `backend/` um arquivo ignorado de ambiente chamado `appsettings.Development.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "OpenRouterApiKey": "sk-or-v1-SUA-CHAVE-ABSOLUTA-AQUI"
}
```

---

## 🚀 Como Rodar Localmente

### 1. Iniciar o Backend (.NET/C#)

1. Navegue até a pasta `backend/`.
2. Certifique-se de definir sua Key do OpenRouter como detalhado acima.
3. Restaure pacotes dependentes e execute o servidor de desenvolvimento:

```bash
cd backend
dotnet restore
dotnet build
dotnet run
```

_O Backend expõe no padrão via `http://localhost:5117`._

### 2. Iniciar o Frontend (Next.js/React)

1. Em um NOVO terminal separado, navegue até a pasta `frontend/`.
2. Instale as dependências.
3. Inicie o compilador do Next:

```bash
cd frontend
npm install
npm run dev
```

_O Frontend será orquestrado via `http://localhost:3000`._

---

## ✅ Endpoint de Self-Diagnostics

Para comodamente medir a confiabilidade dos LLMs ou analisar fallbacks abertos no OpenRouter, dispomos de um route oculto de diagnósticos de latência.

- Dê um GET request contra `http://localhost:5117/api/modelos/testar`
- Ele testa e pinga todas as IAs em cluster garantindo latência abaixo de <1.200ms na pipeline principal.

---

### Equipe de Engenharia / Maintenance

Este monorepo foca na clareza estrutural com Tipagem Total e Clean Architecture patterns. Pull-Requests devem acompanhar cobertura similar de TSDoc / C# XML Docs.
