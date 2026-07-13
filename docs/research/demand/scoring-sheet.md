# Validation scoring sheet

One sheet per participant. Keep observation and interpretation separate.

## Session metadata

| Field | Value |
|---|---|
| Participant ID | |
| Segment | Beginner / Expert / API-tool developer |
| Date/time zone | |
| Interviewer | |
| Prototype build | |
| Data release | |
| Normal tool/baseline | |
| Consent: notes / recording / follow-up / quote | |
| Real task in last 90 days | |

## Last-real-case evidence

| Measure | Value |
|---|---|
| Required output | |
| Workflow steps/tools in order | |
| Outcome | Complete / help / workaround / abandoned / blocked |
| Active time | `<15m` / `15–60m` / `1–4h` / `>4h` / `>1d` / unknown |
| Elapsed time | same scale / unknown |
| Material consequence | None / delay / missed-wrong alert / escalation / paid help / other |
| Similar-task frequency, last 90 days | Once / monthly / weekly / daily / unsupported estimate |
| Evidence strength | Artifact shown / detailed recall / vague recall |
| Observation | |
| Researcher interpretation | |

“Material time loss” gate rule: count only a real case with credible active time ≥1 hour, elapsed delay ≥1 business day, or an explicit operational consequence/escalation. Do not count a hypothetical estimate or prototype task time.

## Per-task scoring

| Task ID | Complete (0/1) | Material correctness (0/1) | Time seconds | Assistance count | Wrong turns | Confidence 1–5 | Would use result (Y/N) | Observed failure |
|---|---:|---:|---:|---:|---:|---:|---|---|
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |

Completion requires correct output and verification, not merely reaching a page. Any wrong OID/index/enum/rights conclusion sets material correctness to `0` even if the participant says the task felt easy.

## Qualitative evidence

- First point of hesitation:
- Tool switch/backtrack:
- Information trusted and why:
- Most dangerous convincing-wrong-answer path:
- Data participant would not upload:
- Blocking adoption constraint:
- Exact participant words (only with quote consent; keep brief):

## Repeat-use record

| Field | Value |
|---|---|
| Another real task expected within 14 days | Y/N |
| Follow-up consent | Y/N |
| Return observed | Y/N; date |
| Return was participant-initiated or scheduled | |
| Real task attempted | |
| Outcome verified | |

Repeat-use gate rule: count only `Return observed = Y` plus a real task attempt. Stated intent does not count.

## Aggregate sheet

| Gate/metric | Beginner | Expert | API/tool dev | Total |
|---|---:|---:|---:|---:|
| Qualified completed sessions | 0/4 | 0/4 | 0/4 | 0/12 |
| Credible material time-loss cases | | | | 0/5 |
| Real repeat prototype uses | | | | 0/3 |
| Task completion rate | | | | |
| Material correctness rate | | | | |
| Median task time | | | | |
| Median assistance count | | | | |

Do not average ordinal confidence scores as if they were interval measurements; report distribution/median. Report segment results separately before an overall total.
