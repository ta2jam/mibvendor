<div align="center">

# mibvendor

**Find the OID, understand its semantics, and keep identity claims defensible.**

[Open mibvendor](https://mibvendor.io) ·
[Use it safely](#use-it-safely) ·
[Free API](#permanently-free-public-api)

</div>

mibvendor is a task-first MIB browser and source-aware OID intelligence service
for monitoring engineers and tool developers. It separates an object OID from
its instance suffix, a PEN registration from a device identity, and an exact
`sysObjectID` match from an unsupported model guess.

## Use the web application

The official public alpha is available at [mibvendor.io](https://mibvendor.io).
It provides:

- task, symbol, module, and numeric OID search;
- structured syntax, enum, constraint, unit, access, status, description, and
  table/index context;
- IANA Private Enterprise Number lookup without retaining contact names or
  email addresses;
- evidence-bounded exact `sysObjectID` lookup with direct PEN, nullable reviewed
  organization key, and explicit `exact_model`, `product_family`,
  `vendor_identifier`, `platform`, `vendor_only`, and conflict states;
- bounded multi-signal device assessment without accepting a raw SNMP walk;
- explicit identity claim strength, including platform-level matches that do
  not assert a hardware model, plus `firmware_scope: "not_established"` so no
  result implies firmware coverage;
- direct, transitive, missing, and cyclic module-dependency states;
- a rights-cleared MIB catalog with source, revision, license, SHA-256, and
  raw-download availability;
- browser-local decoding of numeric `snmpwalk` output.

The active `license-signaled-2026-07-20.2` data release contains 702
redistributable modules and 76,606 searchable catalog OID nodes. It also records
4,138 textual-convention definitions and 1,273 notifications. The release
preserves the 110-module IETF/IANA/Net-SNMP baseline and promotes 592 modules
from nine additional pinned sources whose recognized repository license and
license file satisfy the publication policy. The 32-source public directory
separates 12 redistributable sources from 20 directory-only sources. The PEN
registry remains complete for the bundled IANA snapshot. Unsupported vendors
are not converted into guessed products or models.

The deployed `v0.4.0-alpha.3` release retains 6,391 distinct exact lookup keys in the
immutable `device-identity-2026-07-20.3` release. Its vendor-MIB layer remains
6,199 assignments: 36 narrow,
reviewed Catalyst 9300 model normalizations, 1,491 product-family/category
claims, and 4,672 generic vendor identifiers. A separate, GPL-2.0-only
RackTables-derived dataset contributes 270 medium-confidence exact-model
claims from a pinned static definition table; these are project definitions,
not vendor-MIB assignments or universally resolved models. Of 303 non-root
source candidates, 33 are quarantined. Nineteen definition-observation
overlaps have explicit reviewed dispositions and four remain material
conflicts. The 1,023 sanitized project observations still cover 713 OIDs; the
union of project observations and published definitions covers 964 distinct
OIDs. A new GPL-3.0-or-later, definition-only LibreNMS adapter adds 655
arc-bound platform prefixes across 406 platform keys and 266 PENs. Prefix
evidence is evaluated only for `sysObjectID`, never asserts a model or product
family, and never outranks an exact identity claim. No layer asserts firmware
support, and raw source code, descriptions, walks, or private device fields are
served. Its annotated tag, CI, active release identity, public API/UI checks,
and production monitor are reconciled; the exact publication evidence is in
the [release record](docs/RELEASE.md#v040-alpha3--librenms-platform-prefix-release).

## Use it safely

- Use only `https://mibvendor.io` and `https://mibvendor.io/v1`.
- Never submit an SNMP community string, SNMPv3 credential, device password,
  API secret, hostname, serial number, raw walk, or customer identifier to the
  API.
- Walk text is decoded in the browser tab. The device-identity form sends only
  its named, bounded fields; it never uploads a walk. Remove hostnames, serial
  numbers, addresses, and customer identifiers before submitting optional
  `sysDescr` text.
- Treat a PEN result as a registry assignment, not proof of manufacturer,
  device ownership, authenticity, product family, or model.
- A MIB definition does not prove that a device or firmware implements the
  object. Verify the numeric target against an authorized device.
- Device identity results do not establish firmware compatibility or support.
  Treat `firmware_scope: "not_established"` as a required verification step,
  not as an unknown-version wildcard.

## Permanently free public API

The public API is live at `https://mibvendor.io/v1` and is permanently free:
there is no paid tier, subscription, billing, or paid quota upgrade. It
currently requires no API key. If optional keys are introduced, they will be
free abuse-control credentials only—not a paid feature.

Free access is fair-use bounded, not unlimited use or an availability SLA. The
current service allocates each client 120 fair-use units per minute and bounds
batch, body, query, and page sizes. A normal request costs one unit; device
identity assessment costs four. Every successful response identifies its
immutable `data_release`; identity operations also expose the immutable
`identity_release`, its SHA-256, and the active publication-control view.

Operational links: [service status](https://mibvendor.io/status),
[health probe](https://mibvendor.io/healthz), and
[production-monitor history](https://github.com/ta2jam/mibvendor/actions/workflows/production-monitor.yml).
The status endpoint is a live-process self-check, not uptime history or an SLA.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/search?q=interface+status` | Ranked object discovery |
| `GET` | `/v1/objects/{objectId}` | Structured object intelligence |
| `GET` | `/v1/modules?q=BFD` | Rights-cleared MIB module catalog |
| `GET` | `/v1/modules/{moduleId}` | License, provenance, checksums, dependencies |
| `GET` | `/v1/modules/{moduleId}/raw` | Exact raw MIB + license/notice + provenance TAR, only when approved |
| `GET` | `/v1/sources` | Reviewed publication modes and rights scopes |
| `GET` | `/v1/enterprises/{number}` | IANA PEN assignment |
| `GET` | `/v1/sys-object-ids/{oid}` | Exact identity, arc-bound platform prefix, or PEN boundary |
| `POST` | `/v1/device-identities:assess` | Bounded multi-signal device assessment |
| `GET` | `/v1/modules/{module}/dependencies` | Dependency graph states |
| `POST` | `/v1/resolve:batch` | Order-preserving OID resolution |
| `GET` | `/v1/data-release` | Active release and corpus counts |

RackTables-derived definition example:

```sh
curl --fail-with-body --compressed \
  https://mibvendor.io/v1/sys-object-ids/1.3.6.1.4.1.9.6.1.83.10.1
```

The result identifies `SG 300-10` with
`claim_scope: "open-source-project-device-definition"`, model confidence
`medium`, source-assignment confidence `high`, and
`firmware_scope: "not_established"`. Provenance reports `definition-only` and
`raw_download: false`; it is not presented as vendor-MIB evidence.

Platform-prefix example:

```sh
curl --fail-with-body --compressed \
  https://mibvendor.io/v1/sys-object-ids/1.3.6.1.4.1.30065.1.99
```

Under `device-identity-2026-07-20.3`, this matches the arc prefix
`1.3.6.1.4.1.30065.1` as platform `arista_eos`. The match is arc-bound, so a
textual lookalike such as `.30065.10` does not match `.30065.1`. The result
keeps `model` and `product_family` null, and an exact identity claim takes
precedence when one exists. Check the response's `identity_release` before
depending on this release behavior.

Example batch request:

```sh
curl --fail-with-body https://mibvendor.io/v1/resolve:batch \
  --header 'content-type: application/json' \
  --data '{"oids":["1.3.6.1.2.1.2.2.1.8.7","1.3.6.1.4.1.9.999999"]}'
```

Batch order and duplicate inputs are preserved. Per-item states distinguish
`resolved`, `not_found`, `invalid`, `ambiguous`, and
`unavailable_due_to_rights`. Request failures use RFC 9457
`application/problem+json`.

Example identity assessment:

```sh
curl --fail-with-body https://mibvendor.io/v1/device-identities:assess \
  --header 'content-type: application/json' \
  --data '{"signals":{"sys_object_id":"1.3.6.1.4.1.9.1.2494","ent_physical_model_name":"C9300-48P"}}'
```

The result is `exact_model` because the device-reported model is compatible
with the exact Catalyst 9300 family assignment; the sanitized project fixture
is shown only as corroboration. By contrast, PEN 9 or generic Cisco IOS XE text
cannot resolve to a Catalyst 9300 model, and contradictory SKU signals return
`conflicting_evidence`. A generic exact MIB assignment returns
`vendor_identifier`, not a model or family. POST bodies are limited to 16 KiB,
candidates and conflicts to 32, responses are `no-store`, and each assessment
costs four of the 120 fair-use units available per minute. See the concise
[device-identity contract](docs/DEVICE-IDENTITY.md).

A real `200` response from `GET /v1/enterprises/8072` is:

```json
{
  "data_release": "license-signaled-2026-07-20.2",
  "enterprise": {
    "number": 8072,
    "oid": "1.3.6.1.4.1.8072",
    "organization": "net-snmp",
    "registry_status": "assigned",
    "source": {
      "url": "https://www.iana.org/assignments/enterprise-numbers/enterprise-numbers",
      "updated": "2026-07-10",
      "retrieved_at": "2026-07-14T12:45:22.136Z",
      "sha256": "aca0fe8748ed2d6b9c8f159cd3cc672387e47d6df2bdd21d5a139341fad7eda8",
      "rights": "CC0-1.0"
    },
    "caveat": "A PEN registration identifies the registry assignee; it does not prove device manufacturer, product model, ownership, or authenticity."
  }
}
```

For module pagination, send the returned `next_cursor` unchanged; do not derive
it from result counts:

```sh
curl --fail-with-body \
  'https://mibvendor.io/v1/modules?q=IANA&limit=1&cursor=0'
# The documented response returns next_cursor: 1.
curl --fail-with-body \
  'https://mibvendor.io/v1/modules?q=IANA&limit=1&cursor=1'
```

The live [OpenAPI 3.1 specification](https://mibvendor.io/openapi.json) is the
machine-readable contract. Fair-use limits may change to contain abuse;
clients must read `RateLimit-*` and `Retry-After`, honor `429` responses, and
use `Cache-Control` and `ETag` validators instead of assuming a fixed quota.
GET responses advertise their own cache policy; body-dependent POST results are
`no-store`. Module lists use cursor pagination. Rights-approved download
archives are deterministic, but the active unversioned raw route revalidates
publication controls on every use. The complete policy is recorded in
[ADR 0009](docs/decisions/0009-permanently-free-api.md).

Raw responses are TAR archives containing the exact MIB, `LICENSE.txt`, and
`PROVENANCE.json`. `X-Content-SHA256` identifies the archive and
`X-MIB-SHA256` identifies the exact MIB entry; `Link` relations retain the
license and original source. A missing raw endpoint is not an invitation to
obtain or republish the file indirectly; follow the module/source metadata to
the publisher's official location.

## Data trust

Public availability is not redistribution permission. mibvendor applies four
fail-closed publication modes:

- `redistributable`: parsed metadata, rendered text, API output, raw download,
  and export are approved, with the required notice retained;
- `metadata-only`: only explicitly approved derived fields may be public;
- `directory-only`: only publisher, official source URL, and rights state are
  shown; no vendor OID, symbol, syntax, description, or file checksum is
  extracted;
- `quarantine`: no source content reaches a public response.

Ten vendor-MIB families now publish factual `metadata-only` OID assignments
from a pinned, license-signaled LibreNMS snapshot. Artifact restrictions still
override the repository signal: no raw vendor MIB bytes or descriptions are
retained or served. Direct vendor source records and the legacy IETF class
remain directory-only or quarantined unless their own publication basis allows
more. Public download or a factual-looking OID is not treated as permission.

The IANA PEN snapshot retains only number and organization fields and records
its source date and SHA-256. Seven reviewed PEN links expose a stable macvendor
`organization_key`; every other key is `null`, never name-inferred. Eighteen
Net-SNMP platform identities and one SigScale OCS platform identity are pinned
to exact upstream revisions; none is presented as an exact hardware model. The
LibreNMS platform-prefix layer is separately pinned to its exact
commit, input-tree/file blobs, SHA-256 values, recognized license markers, and
source date. Its raw YAML is not served, and its source-specific kill switch
removes all of its claims without weakening them into model or family guesses.
The immutable identity manifest has its own SHA-256. A separately hashed,
revisioned publication-control document selects the active release and can
disable one source without rewriting historical evidence. Identity responses
expose both hashes and an `identity_view` derived from them, so a kill-switch
change is observable even when `identity_release` is unchanged.
Every raw module is manifest-bound to
its original-source SHA-256, served-artifact SHA-256, license, dependencies,
revision, and immutable data release. A two-event hash-chained publication log
records the baseline and current release promotion; source and module kill
switches default to fail closed.

Current validation boundaries remain published in the
[Phase 0 status](docs/PHASE-0.md) and [product definition](docs/PRODUCT.md).

<div align="center"><sub>The mibvendor application and research foundation are open source on GitHub.</sub></div>
