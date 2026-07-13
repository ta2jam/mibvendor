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
| API demand | 3 concrete integrations validated with builders | `docs/research/demand/` | 3 executable hypotheses; 0 external integrations |
| Rights | Viable approved Tier A/B seed plus one vendor path | `docs/research/rights/` | Narrow IETF/IANA Tier A seed; 0 approved vendor paths |
| Parser | One canonical parser selected from reproducible measurements | `experiments/parser-bakeoff/` | PySMI provisional; 9 synthetic local cases, 100-case/container gate open |
| Prototype | Public task prototype available for sessions | `prototype/` | Local prototype and 50,000-line baseline ready; public hosting pending |

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
