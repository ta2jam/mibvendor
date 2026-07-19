# UI-15 browser verification record

Status: pending production browser verification.

UI-15 must not be closed from source inspection or HTTP probes alone. Complete
this record against the deployed immutable release after deployment. Do not
reuse results from an older release.

## Pre-deployment evidence

Run from the repository root:

```sh
node --check server.mjs
node --check prototype/app.js
node --test tests/server.test.mjs tests/prototype-core.test.mjs tests/phase0-openapi.test.mjs
git diff --check
```

Result on 2026-07-20: passed. Both syntax checks, all 30 focused tests, and
`git diff --check` completed with zero failures. Production browser verification
below remains pending because these checks do not validate deployed UI behavior.

## Production identity

Record the values returned by `GET https://mibvendor.io/status` before testing.

| Field | Observed value |
|---|---|
| `checked_at` | pending |
| `version` | pending |
| `commit` | pending |
| `data_release` | pending |

The status response must use `Cache-Control: no-store`, report
`status: operational`, identify the deployed version, commit, and data release,
and describe itself as a live-process self-check rather than uptime history or
an SLA. Confirm `/healthz` returns `ok` separately.

## Browser matrix

Run every row in a fresh production tab at desktop width and at a 390 px mobile
viewport. Record screenshots or a short screen capture with the production
identity above. Do not include clipboard history, credentials, raw walks, or
customer data in evidence.

| Check | Desktop | 390 px mobile | Required evidence |
|---|---|---|---|
| `Copy curl` writes the exact visible command and updates the live region | pending | pending | Paste into a temporary local text field, compare exactly, then restore or clear the clipboard |
| `Copy pagination` writes both cursor commands and updates the live region | pending | pending | Exact clipboard comparison; no request is sent by copying |
| `Copy JavaScript` writes the exact visible example and updates the live region | pending | pending | Exact clipboard comparison |
| `Copy Python` writes the exact visible example and updates the live region | pending | pending | Exact clipboard comparison |
| `Run first page` renders full JSON for `q=IANA`, `limit=1`, `cursor=0` | pending | pending | Response shows the current `data_release`, cursor `0`, a result, and a non-null `next_cursor` |
| `Load next page` uses the returned `next_cursor` unchanged | pending | pending | Cursor equals the prior `next_cursor` and the result ID changes |
| OpenAPI link opens valid OpenAPI 3.1 JSON | pending | pending | `openapi: 3.1.0`, real success examples, and service links are visible |
| Health link opens `ok` | pending | pending | HTTP 200 and body `ok` |
| Status link opens coherent no-store JSON | pending | pending | HTTP 200; headers and identity match the deployed release |
| Keyboard-only Tab/Shift+Tab/Enter reaches and activates all controls | pending | pending | Focus order remains visible and logical |
| Developer section has no horizontal page overflow | pending | pending | `document.documentElement.scrollWidth === document.documentElement.clientWidth` |
| Console remains free of uncaught errors during the flow | pending | pending | Error count is zero |

If any row fails, leave UI-15 open and record the exact release identity,
viewport, steps, observed result, and console/network error. UI-15 closes only
after both viewport columns pass against the same deployed release.
