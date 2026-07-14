<div align="center">

# mibvendor

**Find the OID, understand its semantics, and keep identity claims defensible.**

[Open mibvendor](https://mibvendor.io) ·
[Use it safely](#use-it-safely) ·
[API](#public-alpha-api)

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
- evidence-bounded `sysObjectID` lookup with explicit exact,
  `enterprise_only`, `not_found`, and `unavailable_due_to_rights` states;
- direct, transitive, missing, and cyclic module-dependency states;
- a rights-cleared MIB catalog with source, revision, license, SHA-256, and
  raw-download availability;
- browser-local decoding of numeric `snmpwalk` output.

The active data release contains 110 redistributable modules and 5,392 parsed
OID nodes: 72 file-reviewed IETF modules, all 20 MIB files directly linked from
IANA's maintained-MIB registry group, and 18 Net-SNMP/UCD/LM-Sensors project
modules from pinned Net-SNMP tag `v5.9.5.2`. Fourteen IETF candidate RFCs were
quarantined because the required code-component notice was not established.
The PEN registry remains complete for the bundled IANA snapshot. Unsupported
vendors are not converted into guessed products or models.

## Use it safely

- Use only `https://mibvendor.io` and `https://mibvendor.io/v1`.
- Never submit an SNMP community string, SNMPv3 credential, device password,
  API secret, hostname, serial number, raw walk, or customer identifier to the
  API.
- Walk text is decoded in the browser tab. Only the separate identity lookup
  forms call the API, using the bounded numeric identifiers visible in those
  fields.
- Treat a PEN result as a registry assignment, not proof of manufacturer,
  device ownership, authenticity, product family, or model.
- A MIB definition does not prove that a device or firmware implements the
  object. Verify the numeric target against an authorized device.

## Public alpha API

The public API is live at `https://mibvendor.io/v1`. It requires no API key
during alpha, is limited to 120 requests per minute per client, and has no
availability SLA. Every successful response identifies its immutable
`data_release`.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/search?q=interface+status` | Ranked object discovery |
| `GET` | `/v1/objects/{objectId}` | Structured object intelligence |
| `GET` | `/v1/modules?q=BFD` | Rights-cleared MIB module catalog |
| `GET` | `/v1/modules/{moduleId}` | License, provenance, checksums, dependencies |
| `GET` | `/v1/modules/{moduleId}/raw` | Raw file only when redistribution is approved |
| `GET` | `/v1/sources` | Reviewed publication modes and rights scopes |
| `GET` | `/v1/enterprises/{number}` | IANA PEN assignment |
| `GET` | `/v1/sys-object-ids/{oid}` | Exact identity or PEN boundary |
| `GET` | `/v1/modules/{module}/dependencies` | Dependency graph states |
| `POST` | `/v1/resolve:batch` | Order-preserving OID resolution |
| `GET` | `/v1/data-release` | Active release and corpus counts |

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

The live [OpenAPI 3.1 specification](https://mibvendor.io/openapi.json) is the
machine-readable contract. Alpha limits may tighten to contain abuse; clients
must read `RateLimit-*` and `Retry-After` headers instead of assuming a fixed
quota.

Raw responses include `X-Content-SHA256` plus `Link` relations for the license
and original source. A missing raw endpoint is not an invitation to obtain or
republish the file indirectly; follow the module/source metadata to the
publisher's official location.

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

There are currently no vendor sources approved for `metadata-only`. The 19
reviewed vendor families and legacy IETF class remain directory-only and their
content intake remains quarantined. Public download or a factual-looking OID is
not treated as permission.

The IANA PEN snapshot retains only number and organization fields and records
its source date and SHA-256. Exact Net-SNMP identities and raw project MIBs are
pinned to a specific upstream revision. Every raw module is manifest-bound to
its original-source SHA-256, served-artifact SHA-256, license, dependencies,
revision, and immutable data release.

Current validation boundaries remain published in the
[Phase 0 status](docs/PHASE-0.md) and [product definition](docs/PRODUCT.md).

<div align="center"><sub>The mibvendor application and research foundation are open source on GitHub.</sub></div>
