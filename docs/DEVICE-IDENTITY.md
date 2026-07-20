# Device identity contract

Device identity is an evidence assessment, not device authentication. A Private
Enterprise Number identifies an IANA registry assignee. A MIB assignment states
that a numeric identifier was defined. Neither fact proves who manufactured,
owns, operates, or currently serves a response from a device.

## Public evidence layers

The active production `device-identity-2026-07-20.3` release keeps five materially different
layers separate:

1. **Registry** — the contact-free IANA PEN snapshot supplies the enterprise
   number and registered organization name.
2. **Vendor-MIB factual metadata** — numeric `OBJECT IDENTIFIER` assignments,
   symbols, source revisions, checksums, and source URLs are normalized from
   pinned artifacts. Artifact-specific restrictions override repository license
   signals: raw MIB text and descriptions are not retained or served from this
   layer.
3. **Open-source project device definitions** — 270 bounded model labels are
   normalized from the pinned RackTables static `known_switches` table. They
   are medium-confidence project definitions, not vendor-MIB assignments.
   The derived dataset is GPL-2.0-only; upstream `COPYING` and `LICENSE` are
   retained. Raw PHP, source descriptions, port summaries, and a raw-data API
   are not published.
4. **Open-source project platform prefixes** — 655 unconditional,
   enterprise-subtree `sysObjectID` prefixes are normalized from the pinned
   LibreNMS OS-detection definitions. They identify only a project platform
   key across 406 platforms and 266 PENs. They do not assert a model, product
   family, vendor ownership, or firmware scope. The derived content is
   GPL-3.0-or-later and definition-only; upstream YAML and descriptions are not
   published by mibvendor.
5. **Project observations** — sanitized LibreNMS and SNMP::Info test fixtures
   show that a project observed a model with an exact `sysObjectID`. These
   records can corroborate an assessment; they never turn that observation into
   a universal model mapping.

The immutable release publishes 6,391 distinct exact lookup keys. The 6,199
vendor-MIB assignments still contain only 36 reviewed model normalizations,
1,491 family/category claims, and 4,672 generic vendor identifiers. RackTables
adds 270 separate exact-model claims at medium confidence. That figure is a
claim count, not a count of reviewed or unconditionally resolved lookups:
four of 19 reviewed definition-observation overlaps remain material conflicts
and return no singular model. The source parser found 303 non-root exact OID
candidates; 33 are quarantined and do not enter runtime lookup. The project
observation layer remains 1,023 observations over 713 OIDs, including 72 OIDs
with conflicting observations. Published exact definitions plus observations
cover 964 distinct OIDs. The prefix adapter publishes a separate 655 prefixes
and quarantines 358 literals: 222 conditional clauses, 124 PEN roots, six
values outside the enterprise tree, three shared Net-SNMP agent prefixes, and
three prefixes used by multiple platforms. Candidate inventory and quarantine
counts are never labeled as public resolution coverage.

Only seven PEN links currently have a reviewed `organization_key` from the
pinned public macvendor organization snapshot. Every other key is `null`; the
service never synthesizes an organization key from a name or PEN.

## Result strength

Results use these ordered states:

- `exact_model`: the submitted evidence supports a model identifier;
- `product_family`: evidence stops at a product family;
- `vendor_identifier`: an exact vendor MIB symbol is known, but it is not
  reviewed as a whole-device model or product family;
- `platform`: evidence identifies software or an agent platform;
- `vendor_only`: only the enterprise boundary is supported;
- `conflicting_evidence`: material signals disagree, so no singular identity is
  asserted;
- `unknown`: no supported identity boundary was found.

Every returned model, product-family, platform, vendor-only, and observation
candidate carries `firmware_scope: "not_established"`. This means the evidence
does not establish any firmware version, range, compatibility, or feature
support. It is not an “all firmware” claim. A top-level resolved or vendor-only
result carries the same value; `unknown` and `conflicting_evidence` carry
`firmware_scope: null` because there is no singular identity result to scope.

An exact numeric lookup describes match method, not automatically claim
strength. For example, an exact OID can resolve to a family node or a generic
vendor identifier. PEN 9 alone therefore remains Cisco vendor evidence and
never becomes “Catalyst 9300.”

A prefix lookup is weaker still. It is evaluated only for `sysObjectID`, uses
longest arc-bound prefix matching, and can produce only a `platform` claim.
`entPhysicalVendorType` never uses this layer. Exact identity evidence always
takes precedence; retained parent-prefix evidence may explain the path but
cannot replace or weaken the exact result. String-prefix lookalikes do not
match: `.30065.1` matches `.30065.1.99`, not `.30065.10`.

The Catalyst 9300 reference cases deliberately distinguish:

- `.1.3.6.1.4.1.9.1.2435` as `C9300-24T`;
- `.1.3.6.1.4.1.9.1.2436` as a different SKU;
- `.1.3.6.1.4.1.9.1.2494` as the Catalyst 9300 family, with a submitted
  `C9300-48P` ENTITY-MIB model signal producing the model assessment and the
  project fixture acting only as corroboration;
- a `.2435` OID combined with `C9300-24P` as conflicting evidence;
- generic “Cisco IOS XE” text as platform/vendor evidence only.

The RackTables reference case
`1.3.6.1.4.1.9.6.1.83.10.1` resolves to `SG 300-10` with
`claim_scope: "open-source-project-device-definition"`, model confidence
`medium`, exact source-assignment confidence `high`, and
`firmware_scope: "not_established"`. Its provenance remains visibly separate
from vendor-MIB metadata and project observations.

The LibreNMS platform reference case
`1.3.6.1.4.1.30065.1.99` matches the declared prefix
`1.3.6.1.4.1.30065.1` and returns platform `arista_eos`, with `model` and
`product_family` null. The evidence records the matched OID, exact pinned
revision, source path, source date, Git blob, and SHA-256. This result
disappears when the `librenms-os-detection` source kill switch is active; it is
not converted to a guessed model or family.

## API and privacy boundary

Use `GET /v1/sys-object-ids/{oid}` for one exact or arc-bound prefix numeric
lookup. Use
`POST /v1/device-identities:assess` to correlate bounded signals:

```json
{
  "identity_release": "device-identity-2026-07-20.3",
  "signals": {
    "sys_object_id": "1.3.6.1.4.1.9.1.2494",
    "ent_physical_model_name": "C9300-48P"
  }
}
```

The assessment endpoint accepts no arrays or raw walk payloads. Do not submit
credentials, community strings, serial numbers, hostnames, addresses, contact
fields, customer identifiers, or arbitrary device output. `sys_descr` is
bounded to 2,048 characters, used only for narrow platform signatures, and is
not returned in the response. POST responses are `no-store`.

Candidates and conflicts are capped at 32. Exact lookup is expected O(1).
Prefix lookup performs at most A descending map probes for A numeric OID arcs,
with the SNMP limit of 128 subidentifiers as the hard constant. The current
`slice`/`join` key construction and string hashing can still perform O(A²)
character work and transient allocation in the worst case; the probe count
alone is O(A), not the complete runtime cost. The startup build is
O(V + D + P + F) for vendor claims V, project definitions D, prefixes P, and
fixture OIDs F. Index memory is O(V + D + P + F); source data and retained
license bytes dominate build-time disk, while exact and prefix maps dominate
identity memory. Reproducible measurements are recorded in the
[prefix benchmark](operations/device-identity-prefix-benchmark.md).
Assessment work is bounded by the fixed signal set and candidate cap. These
bounds contain latency, memory, and abuse cost without creating a paid quota.

The service allocates 120 fair-use units per client per minute. Ordinary
requests cost one unit and this assessment costs four. Clients must honor
`RateLimit-*`, `Retry-After`, and `429`; the quota is abuse control, not an
availability guarantee.

## Immutable release and active view

`identity_release` names the immutable evidence set. Its
`identity_release_sha256` binds the release manifest, source revisions,
dataset checksums, built-in claims, retained license evidence, and runtime-index
digest. Reusing the release name with different evidence fails validation.

Publication controls are intentionally separate and mutable. Their positive
`control_revision`, `control_sha256`, and sorted `disabled_sources` list select
which release sources may answer at that moment. A source kill switch removes
its primary claims and project corroboration instead of inventing a fallback.
The resulting `identity_view` combines the release identifier, release digest,
control revision, and control digest. Pin `identity_release` when repeatability
matters, and record `identity_view` when the exact enabled-source view matters.
An identity-release pin that is not active returns `409`.

The executable contract and current limits are published in the
[OpenAPI document](https://mibvendor.io/openapi.json).

## Corrections

Every result carries its identity release and evidence provenance. A correction
must replace the immutable identity release or disable a source; it must not
silently rewrite an existing release. Report a questionable mapping with the
numeric OID, claimed field, source URL, and non-sensitive counter-evidence. Do
not attach a raw walk or customer data.

Public identity contributions use the separate
[contribution quarantine](DEVICE-IDENTITY-CONTRIBUTIONS.md). A contribution or
maintainer evidence approval does not alter the website, API, active identity
view, or immutable release. Promotion remains a distinct release operation.
The ledgers currently contain no events or reviews and establish no community
adoption.
