# ADR 0001: Close Phase 0 before selecting the production stack

Status: Accepted
Date: 2026-07-13

## Decision

Build only the dependency-free task prototype and research harnesses during
Phase 0. Do not scaffold the production web/database stack until demand, rights,
and canonical parser gates pass.

## Rationale

The main uncertainties are not framework feasibility. They are user demand,
publishable corpus coverage, and normalized parser fidelity. A production stack
would neither reduce nor measure those risks and would create migration work if
the product narrows.

## Consequences

- Prototype code is disposable and must not become the production data model by
  accident.
- Phase 0 CI validates research structure and prototype behavior only.
- Production architecture remains a documented hypothesis.
