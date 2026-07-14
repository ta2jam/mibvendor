# FAZ 0 — Demand validation pack

Last desk-research review: 2026-07-13

This directory prepares, but does not replace, real-user validation. Public forum posts, official product documentation, product pages, and accessible store listings provide evidence that the jobs exist. They do not establish market size, willingness to pay, task success, or repeat use.

Files:

- `evidence-register.md`: source quality, observations, and access limitations.
- `task-catalog.md`: 41 candidate jobs/problems with persona, evidence mode, severity/frequency signal, and a falsifiable validation task.
- `recruitment-screener.md`: recruitment criteria for 4 beginners, 4 experts, and 4 API/tool developers.
- `interview-guide.md`: neutral 30-minute interview protocol.
- `validation-tasks.md`: moderated task tests and pass criteria.
- `consent-privacy.md`: minimal-data consent and handling rules.
- `scoring-sheet.md`: per-session and aggregate scoring.
- `api-scenarios.md`: three unvalidated API integration hypotheses expressed as contracts and tests.
- `phase0-openapi.json`: machine-checked OpenAPI 3.1 contract for the local-only
  synthetic probe; it is not a hosted or supported public API.
- `prototype-performance.md`: one reproducible 50,000-line synthetic walk baseline and its limits.
- `validation-evidence.json`: machine-checked, privacy-minimized participant,
  repeat-use, and external integration evidence register. It intentionally
  contains zero claimed observations until real artifacts exist.
- `operations-runbook.md`: exact recruitment-to-evidence workflow and the
  distinction between an observation and an unsupported claim.
- `gate-status.md`: what is actually complete, what remains unverified, and which gate is blocked.

Evidence labels:

- `Direct observation`: the linked user or official source explicitly describes the job/problem.
- `Inference`: a proposed job or requirement derived from a linked observation; it must be tested with users.

Severity/frequency labels are signals, not population estimates. `High` means the source reports blocked work, multi-hour/day effort, operational correctness risk, or the same problem appears in several independent sources. `Medium` means material friction or error risk is explicit. `Low` means feature interest without demonstrated loss.
