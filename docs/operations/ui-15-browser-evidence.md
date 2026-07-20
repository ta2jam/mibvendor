# UI-15 browser verification record

Status: complete for deployed `v0.4.0-alpha.2`.

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
`git diff --check` completed with zero failures. The immutable release then
passed the full repository verifier and production monitor.

## Production identity

Record the values returned by `GET https://mibvendor.io/status` before testing.

| Field | Observed value |
|---|---|
| `checked_at` | `2026-07-20T04:07:30.499Z` |
| `version` | `0.4.0-alpha.2` |
| `commit` | `4b8a89dcddea11ef8b7afdd262daf7e8a6cffbc8` |
| `data_release` | `license-signaled-2026-07-20.2` |
| `identity_release` | `device-identity-2026-07-20.2` |

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
| `Copy curl` writes the exact visible command and updates the live region | passed | passed | Exact clipboard comparison passed; clipboard was cleared after the check |
| `Copy pagination` writes both cursor commands and updates the live region | passed | passed | Both visible payloads matched exactly; copying sent no request |
| `Copy identity request` writes the exact visible example and updates the live region | passed | passed | Exact clipboard comparison passed; copying sent no request |
| `Copy JavaScript` writes the exact visible example and updates the live region | passed | passed | Exact clipboard comparison passed |
| `Copy Python` writes the exact visible example and updates the live region | passed | passed | Exact clipboard comparison passed |
| `Run first page` renders full JSON for `q=IANA`, `limit=1`, `cursor=0` | passed | passed | Release identity, cursor `0`, result, and non-null `next_cursor` were asserted |
| `Load next page` uses the returned `next_cursor` unchanged | passed | passed | Cursor advanced from `0` to `1` and the result ID changed |
| OpenAPI link opens valid OpenAPI 3.1 JSON | passed | passed | Secondary-link navigation returned valid OpenAPI 3.1 JSON |
| Health link opens `ok` | passed | passed | Secondary-link navigation returned HTTP 200 and body `ok` |
| Status link opens coherent no-store JSON | passed | passed | Secondary-link navigation returned the deployed release identity |
| Keyboard-only Tab/Shift+Tab/Enter reaches and activates all controls | passed | passed | Full forward/reverse cycles covered 77 desktop and 81 mobile sequential focus stops. All developer controls appeared; Enter activated five copy buttons, both cursor actions, the error-details toggle, and all three service links. |
| Developer section has no horizontal page overflow | passed | passed | `scrollWidth === clientWidth` at 1280×900 and 390×844 |
| Console remains free of uncaught errors during the flow | passed | passed | Console, page-error, and request-error counts were zero; no Cloudflare beacon request occurred |

The same run also passed exact and conflicting device-identity deep routes. It
used production Chromium at 1280×900 and 390×844 against immutable tag
`v0.4.0-alpha.2`. No credential, raw walk, customer datum, clipboard value, or
private source content was captured. Persistent viewport evidence is retained
in the [machine-readable result record](./evidence/v0.4.0-alpha.2/ui15-browser-results.json),
[desktop top](./evidence/v0.4.0-alpha.2/ui15-desktop.png),
[desktop controls](./evidence/v0.4.0-alpha.2/ui15-desktop-controls.png),
[390 px top](./evidence/v0.4.0-alpha.2/ui15-mobile-390.png), and
[390 px controls](./evidence/v0.4.0-alpha.2/ui15-mobile-390-controls.png).

If any row fails or remains partial, leave UI-15 open and record the exact release identity,
viewport, steps, observed result, and console/network error. UI-15 closes only
after both viewport columns pass against the same deployed release.
