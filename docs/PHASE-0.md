# Phase 0 gate

Version: 1.0
Owner: repository owner
Status: **OPEN**

Phase 0 is an evidence gate. Producing documents or a prototype does not close
it. Every criterion needs a dated artifact or observation.

| Workstream | Exit criterion | Evidence location | Current state |
|---|---|---|---|
| Task demand | At least 30 participant-derived tasks | `docs/research/demand/` | 41 desk candidates; 0 participant-derived |
| Material loss | At least 5 observed users lose material time | `docs/research/demand/` | 2 public anecdotes with duration; 0 observed participants |
| Repeat use | At least 3 participants return for a second task | `docs/research/demand/` | 0 observed returns |
| API demand | 3 concrete integrations validated with builders | `docs/research/demand/` | Live bounded public-alpha contract; 0 external integrations |
| Rights | Viable approved Tier A/B seed plus one licensed source path capable of vendor-family coverage | `docs/research/rights/` | Passed under ADR 0008: 702 active modules from 12 redistributable sources; 20 directory-only sources and 14 RFC candidates remain excluded. Direct vendor permission is optional scope expansion, not this gate's publication basis. |
| Parser | One canonical parser selected from reproducible measurements | `experiments/parser-bakeoff/` | PySMI provisional; pinned Linux amd64 and native arm64 containers pass 9 CC0 edge cases with identical normalized evidence. A deterministic 100-file positive-breadth corpus passes rights, uniqueness, provenance, source-diversity, and feature-coverage eligibility; its three-parser native multi-architecture execution and selection decision remain open. |
| Prototype | Public task prototype available for sessions | `prototype/` | Passed: [mibvendor.io](https://mibvendor.io) is the production origin; rights-aware module catalog, licensed raw downloads, browser-local walk decoding, dependency states, and the 50,000-line baseline are deployed. The expanded device-identity workbench and RackTables exact-definition layer are deployed as immutable `v0.4.0-alpha.2`; tag, commit, image, CI, VPS state, public API/UI checks, and production monitoring are reconciled. |

## Decision rule

Proceed to Phase 1 only when all rows are evidenced. If demand gates fail, narrow
or stop the product rather than replacing field evidence with forum counts. If
rights gates fail, narrow the public corpus rather than publishing unknown-rights
metadata. If parser evidence is inconclusive, extend the corpus or diagnostics;
do not combine multiple parsers without a measured need.

## Evidence integrity

- Desk research is directional evidence, not an interview.
- A task inferred from a forum post is not participant-derived until a user
  confirms the task and context.
- A stated intention to reuse is not repeat use.
- Public availability is not redistribution approval.
- A parser that accepts a file is not correct unless required fields and
  deterministic output are checked.
