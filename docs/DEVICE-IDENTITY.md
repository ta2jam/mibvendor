# Device identity contract

Device identity is an evidence assessment, not device authentication. A Private
Enterprise Number identifies an IANA registry assignee. A MIB assignment states
that a numeric identifier was defined. Neither fact proves who manufactured,
owns, operates, or currently serves a response from a device.

## Public evidence layers

The `device-identity-2026-07-20.1` release keeps three materially different
layers separate:

1. **Registry** — the contact-free IANA PEN snapshot supplies the enterprise
   number and registered organization name.
2. **Vendor-MIB factual metadata** — numeric `OBJECT IDENTIFIER` assignments,
   symbols, source revisions, checksums, and source URLs are normalized from
   pinned artifacts. Artifact-specific restrictions override repository license
   signals: raw MIB text and descriptions are not retained or served from this
   layer.
3. **Project observations** — sanitized LibreNMS and SNMP::Info test fixtures
   show that a project observed a model with an exact `sysObjectID`. These
   records can corroborate an assessment; they never turn that observation into
   a universal model mapping.

The immutable release contains 6,199 vendor-MIB exact OID assignments across
ten enterprise families. Only 36 narrow, reviewed Catalyst 9300 normalizations
assert an exact device model. Another 1,491 assignments stop at a product
family or category. The remaining 4,672 expose a generic vendor MIB identifier
and assert neither a whole-device model nor a product family; the identifier
may describe a device, chassis, module, line card, or component. A separate
project layer contains 1,023 sanitized observations over 713 exact OIDs,
including 72 OIDs with conflicting observations. Those observations are not
added to any primary mapping category.

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

The Catalyst 9300 reference cases deliberately distinguish:

- `.1.3.6.1.4.1.9.1.2435` as `C9300-24T`;
- `.1.3.6.1.4.1.9.1.2436` as a different SKU;
- `.1.3.6.1.4.1.9.1.2494` as the Catalyst 9300 family, with a submitted
  `C9300-48P` ENTITY-MIB model signal producing the model assessment and the
  project fixture acting only as corroboration;
- a `.2435` OID combined with `C9300-24P` as conflicting evidence;
- generic “Cisco IOS XE” text as platform/vendor evidence only.

## API and privacy boundary

Use `GET /v1/sys-object-ids/{oid}` for one exact numeric lookup. Use
`POST /v1/device-identities:assess` to correlate bounded signals:

```json
{
  "identity_release": "device-identity-2026-07-20.1",
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

Candidates and conflicts are capped at 32. Exact lookup is O(1) after an
O(records + observations) startup index build; assessment work is bounded by
the small fixed signal set and candidate cap. These bounds contain latency,
memory, and abuse cost without creating a paid quota.

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
