# ADR-001: Modular Monolith First

**Status:** Accepted as the current planning baseline

## Context

`assistente-super-prompt` is already a product-shaped monorepo with:

- one Next.js frontend
- one .NET 8 backend
- a real multi-agent prompt pipeline
- meaningful product flows already in use

The current codebase does not yet have explicit internal boundaries.

Today:

- backend logic is concentrated in `PromptController`
- frontend behavior is concentrated in `src/app/page.tsx`
- there is no test foundation or CI guardrail yet

A large rewrite or service split at this stage would increase delivery risk and reduce reviewability.

## Decision

We will evolve the system as a modular monolith first.

That means:

- keep the monorepo shape
- keep a single frontend deployable and a single backend deployable
- clarify boundaries internally before extracting assemblies, packages or services
- prefer issue-sized refactors that improve contracts, testability and ownership step by step

## Consequences

### Positive

- lower migration risk
- easier PR review
- better compatibility with the current product surface
- clearer path to testing and CI without redesigning deployment

### Negative

- some temporary duplication or adapters may exist during the transition
- controller-centric and page-centric code will remain for a while during staged extraction
- architecture cleanup will take multiple iterations instead of one large rewrite

### Risks

- if issues become too large, the modular-monolith strategy can still turn into a hidden rewrite
- if contracts are not formalized early, frontend/backend drift will continue
- if tests lag behind refactors, internal boundary work will remain fragile

## Alternatives Discarded

- Immediate microservice split
  - discarded because the current codebase is too boundary-immature for that move
- Full backend rewrite into layered projects now
  - discarded because it would mix architectural cleanup, functional risk and test foundation work in one step
- Full frontend rewrite before API contract stabilization
  - discarded because UI modularization without contract clarity would increase rework

## Follow-up

This ADR is implemented through the existing backlog, starting with architecture documentation, test foundation and contract formalization.
