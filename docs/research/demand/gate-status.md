# FAZ 0 demand gate status

Status date: 2026-07-13

The desk-research deliverables are prepared. The demand-validation gate is **not passed**. Starting product implementation as if demand were validated would misstate evidence.

## Gate accounting

| Criterion | Current evidence | Status |
|---|---|---|
| At least 30 real tasks/problems cataloged | 41 candidate task rows grounded in public first-person reports, official workflows, and product capabilities. Several rows derive from the same source/workflow and are not independent users. | Desk-research threshold met; user-validation threshold not met. |
| 4 beginner interviews | 0 completed. Screener, guide, tasks, consent, and score sheet prepared. | Not met. |
| 4 expert interviews | 0 completed. | Not met. |
| 4 API/tool-developer interviews | 0 completed. | Not met. |
| At least 5 users demonstrate material time loss | 0 qualified interviewed users. Desk evidence includes two explicit strong duration reports: almost two days for 47 items and weeks of investigation; several other blocked/struggle reports lack credible time measurement. | Not met. Public anecdotes cannot be counted as our five validated users. |
| At least 3 users repeat-use the prototype for a real task | No prototype sessions or observed returns. | Not met. Stated intent would not count. |
| 3 real API integration scenarios | Three contract hypotheses are documented; zero has been exercised or accepted by an external integrator. | Hypotheses prepared; real-integration criterion not met. |

## What desk evidence does support

- Desired-metric-to-OID discovery is repeatedly reported as difficult, especially when vendor MIBs, firmware support, and tables/indexes are involved.
- A flat MIB tree or whole-MIB conversion does not complete the monitoring job; users still select, validate, and translate objects into platform-specific configuration.
- Numeric walk decoding, table grouping, enum rendering, and index correlation are concrete jobs, not invented features.
- Reproducible provenance and rights scopes are necessary safety constraints, though public evidence does not establish that users will pay for them.
- Existing products expose relevant capabilities, but there is no comparative task test proving that mibvendor’s proposed UX is faster or easier.

## Required human actions and dependencies

These cannot be completed by repository work alone:

1. Recruit and schedule 12 qualified participants using `recruitment-screener.md`.
2. Decide and fund any participant incentive; record it consistently without coercive conditions.
3. Provide/approve a contact and deletion-request route for research privacy notices.
4. Supply or authorize sanitized real fixtures where participants cannot bring their own. Do not upload proprietary MIBs/walks without rights.
5. Run 12 moderated sessions against a consistent prototype build and enter results in `scoring-sheet.md`.
6. Keep a usable prototype available for 14-day real-task return measurement.
7. Obtain at least three qualified API/tool developers willing to exercise the contracts against real integration code; verbal approval is insufficient.

Dependencies:

- Material-time-loss gate depends on completed interviews and credible last-real-case evidence.
- Comparative UX claims depend on a testable prototype plus baseline task runs.
- Repeat-use gate depends on the first sessions, follow-up consent, an available prototype, and elapsed real work opportunities.
- “Real API scenario” status depends on an executable API stub or contract mock and external integration exercise.

## Decision rule

Do not mark FAZ 0 demand validation complete until all of these are true:

- 4/4/4 qualified sessions completed.
- ≥5 distinct participants meet the material-time-loss rule in `scoring-sheet.md`.
- ≥3 distinct participants return and attempt a real task with the prototype.
- ≥3 external API/tool developers exercise a scenario or provide integration artifacts that expose concrete contract requirements.
- No dominant material-correctness failure invalidates the proposed core workflow.

If recruitment yields the tasks but not repeat use or material loss, narrow or stop the product; do not reinterpret weak evidence as validation.
