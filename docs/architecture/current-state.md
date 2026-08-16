# Current State

## Scope
This document describes the real worktree state of `assistente-super-prompt` as the baseline for incremental refactors.

It is intentionally descriptive, not aspirational.

## Monorepo Shape

```text
.
├─ .github/workflows/ci.yml
├─ assistente-super-prompt.sln
├─ AGENTS.md
├─ backend/
│  ├─ Configuration/
│  │  ├─ OpenRouterOptions.cs
│  │  ├─ ApiProtecaoOptions.cs
│  │  └─ ApiKeyMiddleware.cs
│  ├─ Controllers/PromptController.cs
│  ├─ Models/
│  │  ├─ PromptModels.cs
│  │  └─ ExecutorPerfis.cs
│  ├─ ApiAssistente.Tests/
│  │  ├─ Unit/
│  │  └─ Smoke/
│  ├─ Program.cs
│  ├─ ApiAssistente.csproj
│  └─ appsettings.Example.json
├─ frontend/
│  ├─ src/app/          (page.tsx, layout.tsx, globals.css)
│  ├─ src/lib/          (api, storage, format + testes)
│  ├─ .env.example
│  └─ package.json
└─ docs/architecture/
```

Observed gaps in the repository root:

- `assistente-super-prompt.sln` groups the API and its test project.
- CI runs backend build/test, frontend check and a UTF-8 encoding gate.
- The frontend has no feature/module split yet; only `src/lib/` was extracted from the page.

## Backend Today

### Runtime and entrypoint

- The backend is a single .NET 8 Web API project in `backend/`.
- [`Program.cs`](../../backend/Program.cs) still acts as startup and also owns an operational diagnostics endpoint: `GET /api/modelos/testar`.
- Configuration is bound to `OpenRouterOptions` (section `OpenRouter`), which also accepts the root `OpenRouterApiKey` key documented in the README. Models, timeouts, token budget and CORS origins are configuration-driven.

### Main behavioral boundary

- [`PromptController.cs`](../../backend/Controllers/PromptController.cs) is the dominant backend module.
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

- [`PromptModels.cs`](../../backend/Models/PromptModels.cs) mixes:
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

- Rule orchestration, integration and HTTP concerns are still tightly coupled in one controller.
- Configuration is now isolated in `Configuration/OpenRouterOptions.cs`, but orchestration and the OpenRouter gateway are not.
- Pure parsing and normalization helpers are `internal static` and covered by `backend/ApiAssistente.Tests` (unit and startup smoke tests).
- Routes under `/api/prompt` have a fixed-window rate limiter and an optional `X-Api-Key` check (`ApiProtecao`).

## Frontend Today

### App structure

- The frontend is a Next.js App Router application in `frontend/`.
- The functional product surface is concentrated in a single file: [`src/app/page.tsx`](../../frontend/src/app/page.tsx).
- [`layout.tsx`](../../frontend/src/app/layout.tsx) and [`globals.css`](../../frontend/src/app/globals.css) are thin compared to `page.tsx`.

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
- Product behavior and presentation are coupled.
- The page is too large to review safely as one unit for future feature work.
- `src/lib/` (api, storage, format) is covered by vitest; components have no test coverage yet.
- Some UI affordances are inert: drag-to-reorder, the project chat and the per-task history are rendered or stored but do nothing.

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

- [`README.md`](../../README.md) now reflects safer local secret handling, but it is not yet the full architecture source of truth.
- `docs/architecture/` contains the ADR, this document and the target state.
- Audit reports and working notes are deliberately NOT versioned (see `AGENTS.md`).
- `.github/workflows/ci.yml` runs three jobs on every push and pull request: backend build/test over the solution, frontend typecheck/lint/test/build, and a UTF-8 encoding gate over all tracked files.

## What should be preserved right now

- Keep the repository as a monorepo with one frontend app and one backend app.
- Keep the public route names stable while boundaries are being clarified internally.
- Prefer small, reviewable refactors over large structural rewrites.
- Do not split into separate deployables or services at this stage.
