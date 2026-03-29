# Current State

## Scope
This document describes the real worktree state of `assistente-super-prompt` as the baseline for incremental refactors.

It is intentionally descriptive, not aspirational.

## Monorepo Shape

```text
.
â”œâ”€ backend/
â”‚  â”œâ”€ Controllers/PromptController.cs
â”‚  â”œâ”€ Models/PromptModels.cs
â”‚  â”œâ”€ Program.cs
â”‚  â”œâ”€ ApiAssistente.csproj
â”‚  â”œâ”€ appsettings.json
â”‚  â””â”€ appsettings.Example.json
â”œâ”€ frontend/
â”‚  â”œâ”€ src/app/page.tsx
â”‚  â”œâ”€ src/app/layout.tsx
â”‚  â”œâ”€ src/app/globals.css
â”‚  â””â”€ package.json
â””â”€ docs/
   â””â”€ ai/
```

Observed gaps in the repository root:

- There is no `.sln` or dedicated backend test project yet.
- There is no `.github/workflows/` directory yet.
- There is no frontend feature/module split yet.

## Backend Today

### Runtime and entrypoint

- The backend is a single .NET 8 Web API project in `backend/`.
- [`Program.cs`](/C:/Github/assistente-super-prompt/backend/Program.cs) still acts as startup and also owns an operational diagnostics endpoint: `GET /api/modelos/testar`.
- Configuration is read directly from `IConfiguration`, with `OpenRouterApiKey` now documented as coming from environment variables, `dotnet user-secrets`, or a local ignored `appsettings.Development.json`.

### Main behavioral boundary

- [`PromptController.cs`](/C:/Github/assistente-super-prompt/backend/Controllers/PromptController.cs) is the dominant backend module.
- The controller currently owns:
  - request validation
  - prompt pipeline orchestration
  - ambiguity detection
  - complexity triage
  - role/format detection
  - analysis, generation and validation prompts
  - HTTP integration with OpenRouter
  - model fallback logic
  - timeout handling
  - response shaping

This means the current backend boundary is controller-centric, not service-centric.

### Domain and contract shape

- [`PromptModels.cs`](/C:/Github/assistente-super-prompt/backend/Models/PromptModels.cs) mixes:
  - transport models (`PromptRequest`, `RegerarRequest`)
  - domain enum (`TipoObjetivo`)
  - helper records (`PerguntaClarificacao`, `SubTarefaItem`)
  - objective configuration lookup (`ObjetivoConfigs`)
- The enum `TipoObjetivo` is already a stable domain anchor and must be preserved.

### Operational characteristics

- OpenRouter is the only external AI integration currently wired into the backend.
- The generation step already uses fallback models.
- The API exposes two functional routes in the controller:
  - `POST /api/prompt/gerar`
  - `POST /api/prompt/regerar`
- A diagnostics route exists outside controllers:
  - `GET /api/modelos/testar`

### Current risks

- Rule orchestration, integration and HTTP concerns are tightly coupled in one controller.
- Error handling still returns internal exception messages in some paths.
- Configuration, diagnostics and pipeline behavior are not yet isolated into explicit modules.
- There is no automated backend test suite yet.

## Frontend Today

### App structure

- The frontend is a Next.js App Router application in `frontend/`.
- The functional product surface is concentrated in a single file: [`src/app/page.tsx`](/C:/Github/assistente-super-prompt/frontend/src/app/page.tsx).
- [`layout.tsx`](/C:/Github/assistente-super-prompt/frontend/src/app/layout.tsx) and [`globals.css`](/C:/Github/assistente-super-prompt/frontend/src/app/globals.css) are thin compared to `page.tsx`.

### What `page.tsx` currently owns

The page currently combines:

- landing page presentation
- goal selection UI
- prompt request composition
- direct `fetch` calls to the backend
- response parsing
- ambiguity flow UI
- project queue / todo flow
- regeneration flow
- prompt history
- `localStorage` persistence
- output rendering and export actions

The frontend is therefore page-centric and feature-coupled.

### Worktree note

- `page.tsx` is also an active local worktree surface.
- Future refactors should assume the current monolithic page is the source state, not a hypothetical modular frontend that does not exist yet.

### Current risks

- Backend contract parsing is embedded in the page.
- API base URL is still hardcoded in the page.
- Product behavior and presentation are coupled.
- The page is too large to review safely as one unit for future feature work.
- There is no frontend test runner or component test coverage yet.

## Contracts and Flows

## Preserved product flows

The following behaviors already exist and must be preserved through refactors:

- multi-agent prompt pipeline
- `TipoObjetivo`
- clarificacao
- plano de divisao
- regeracao
- historico

## Current API response families

`POST /api/prompt/gerar` currently returns one of:

- `clarificacao_necessaria`
- `plano_de_divisao`
- `prompt_gerado`

`POST /api/prompt/regerar` returns:

- `prompt_melhorado`

The current contract is functional but not formally versioned or centralized.

## Documentation and operational guardrails today

- [`README.md`](/C:/Github/assistente-super-prompt/README.md) now reflects safer local secret handling, but it is not yet the full architecture source of truth.
- `docs/ai/` contains Codex operating prompts and review checklists.
- There is still no repository-level CI pipeline in `.github/workflows`.

## What should be preserved right now

- Keep the repository as a monorepo with one frontend app and one backend app.
- Keep the public route names stable while boundaries are being clarified internally.
- Prefer small, reviewable refactors over large structural rewrites.
- Do not split into separate deployables or services at this stage.
