# Target State

## Decision Summary

The target architecture for `assistente-super-prompt` is a modular monolith, not a multi-service rewrite.

The goal is to create clearer internal boundaries while preserving the current product surface and route compatibility.

## Constraints

These constraints are intentional:

- preserve the multi-agent pipeline
- preserve `TipoObjetivo`
- preserve clarificacao, plano de divisao, regeracao and historico
- preserve Next.js + React in the frontend
- preserve .NET 8 Web API in the backend
- avoid mega-refactors
- prefer issue-sized slices that can be reviewed independently

## Backend Target Boundaries

Target internal shape:

```text
backend/
  Api/
    Controllers/
    Contracts/
    Diagnostics/
    Filters/
  Application/
    PromptPipeline/
    Regeneration/
    Diagnostics/
  Domain/
    Prompting/
    Objectives/
    Validation/
  Infrastructure/
    Llm/
    Configuration/
    Logging/
```

### Responsibility split

- `Api/`
  - receives HTTP requests
  - validates transport input
  - maps application results to HTTP responses
  - must not own orchestration logic
- `Application/`
  - coordinates the prompt pipeline
  - decides flow branches such as clarificacao vs plano de divisao vs prompt final
  - isolates use cases such as `GeneratePrompt` and `RegeneratePrompt`
- `Domain/`
  - owns `TipoObjetivo`
  - owns objective configuration and prompt-related rules
  - contains pure logic that should be unit-testable without HTTP
- `Infrastructure/`
  - owns OpenRouter access
  - owns timeout, fallback and external model diagnostics mechanics
  - owns configuration binding and runtime adapters

### Backend non-goals for now

- no microservices
- no separate deployable workers
- no public API redesign in one step
- no immediate multi-project breakup unless tests and boundaries justify it later

## Frontend Target Boundaries

Target internal shape:

```text
frontend/src/
  app/
    page.tsx
  features/
    prompt-builder/
    project-queue/
    prompt-history/
  lib/
    api/
    contracts/
    storage/
    config/
```

### Responsibility split

- `app/page.tsx`
  - composition root only
  - assembles feature modules
  - should stop owning direct API parsing and storage logic
- `features/prompt-builder/`
  - prompt request UI
  - clarificacao flow
  - result rendering
- `features/project-queue/`
  - plano de divisao
  - queue and task progression
  - per-task regeneration UX
- `features/prompt-history/`
  - history read/write and UI
- `lib/api/`
  - API client
  - request/response mapping
- `lib/contracts/`
  - frontend contract types for backend payloads
- `lib/storage/`
  - `localStorage` adapters and persistence helpers
- `lib/config/`
  - environment-driven configuration such as API base URL

### Frontend non-goals for now

- no full redesign as part of architectural cleanup
- no state management library unless the current split proves insufficient
- no attempt to solve every page concern in one PR

## Contract Strategy

The frontend and backend should move toward explicit contracts without breaking current behavior.

Incremental rule:

- preserve the current JSON shapes first
- centralize mapping second
- only evolve contract structure after both sides have stable adapters and tests

Practical implication:

- backend DTOs should become explicit before new behavior is layered on top
- frontend should consume a typed API client instead of parsing raw response objects in `page.tsx`

## Testing Strategy by Boundary

### Backend

- unit tests for domain rules and parser helpers
- application tests for branch decisions in the prompt pipeline
- integration tests for `gerar`, `regerar` and diagnostics routes with fake OpenRouter responses

### Frontend

- unit tests for API mappers and storage helpers
- component tests for clarificacao, history and queue flows
- build and lint must become baseline CI gates before broader refactors

## Delivery Guardrails

Every future refactor should be issue-driven and respect these rules:

- one issue, one branch, one PR
- no stacked PRs by default
- `main` remains the base branch
- docs update when setup, architecture or contracts change
- CI must eventually gate lint, build and tests for both apps

## Backlog Reference

The target state is intentionally aligned to this backlog:

- [#1 Harden local config and secret handling](https://github.com/alessandrolsdev/assistente-super-prompt/issues/1)
- [#2 Document current architecture and target boundaries](https://github.com/alessandrolsdev/assistente-super-prompt/issues/2)
- [#3 Create backend solution and test foundation](https://github.com/alessandrolsdev/assistente-super-prompt/issues/3)
- [#4 Formalize API contracts and error boundary](https://github.com/alessandrolsdev/assistente-super-prompt/issues/4)
- [#5 Extract prompt orchestration and OpenRouter gateway](https://github.com/alessandrolsdev/assistente-super-prompt/issues/5)
- [#6 Create frontend API client and shared contract mapping](https://github.com/alessandrolsdev/assistente-super-prompt/issues/6)
- [#7 Modularize prompt builder UI and add frontend tests](https://github.com/alessandrolsdev/assistente-super-prompt/issues/7)
- [#8 Add GitHub Actions and repo delivery guardrails](https://github.com/alessandrolsdev/assistente-super-prompt/issues/8)

Recommended execution order:

1. configuration and documentation baseline
2. backend test foundation
3. contract formalization
4. backend orchestration extraction
5. frontend API boundary
6. frontend modularization and tests
7. CI guardrails

## Out of Scope Large Refactors

These are explicitly out of scope until the backlog above advances:

- splitting frontend and backend into multiple repos
- introducing multiple backend services
- rewriting the prompt pipeline from scratch
- changing core product flows while boundaries are still unstable
