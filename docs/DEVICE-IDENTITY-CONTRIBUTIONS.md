# Device identity contributions

This contract is an intake boundary for data used by the hosted mibvendor.io service. It is not a self-hosting, deployment, or release-promotion guide.

The contribution ledgers are public GitHub data. Every accepted event, evidence URL, observation value, checksum, reason, and review is visible permanently in repository history. Do not contribute data that cannot be published. The contract does not collect a name or email, but a GitHub account and commit metadata can still identify a contributor; the process is not anonymous.

The ledgers are empty at introduction. Their presence does not establish community adoption, vendor participation, or evidence approval.

## Publication boundary

All contribution events start and remain in `quarantine`. `automatic_publication` is fixed to `false`; a review with `approved-evidence` still does not activate a claim. A separate, explicit identity-release promotion is required before the hosted website or API may use it.

The fixed event-ledger policy is:

- `publication_state`: `quarantine`
- `automatic_publication`: `false`
- `raw_walks_allowed`: `false`
- `sensitive_values_allowed`: `false`
- `review_required`: `true`
- `promotion_required`: `true`

Changing those values inside a contribution is invalid.

## Forbidden content

Never submit:

- raw or partial SNMP walks, raw MIB files, packet captures, or command output;
- `sysDescr`, SNMP community strings, credentials, API tokens, private keys, or authenticated URLs;
- serial numbers, MAC addresses, IP addresses, UUIDs, hostnames, contacts, or locations;
- customer, tenant, user, employee, site, asset, or ticket identifiers;
- non-public vendor material or evidence whose publication rights are unclear.

An append-only correction or withdrawal cannot erase a secret from Git history. Forbidden data must not enter the ledger in the first place. If it does, normal withdrawal is not a remediation mechanism.

## Contribution events

[`device-identity-contribution-event.schema.json`](../contracts/device-identity-contribution-event.schema.json) defines one strict JSON Schema 2020-12 event. Unknown fields are rejected.

Events are append-only:

- `propose` creates a new `mapping_id` and has `supersedes_event_id: null`;
- `correct` carries the full replacement claim and must supersede the current event for the same mapping;
- `withdraw` supersedes the current event, carries no claim or observation, and leaves both provenance maps empty.

Existing events are never edited, deleted, or reordered. The ledgers and generated report use deterministic two-space JSON with one trailing newline; formatting drift and duplicate object keys are rejected. `event_id` embeds the canonical UTC-seconds timestamp from `occurred_at`. Event-chain and timestamp equality are checked across the complete ledger, not by JSON Schema alone.

`authority.relationship` records only the submitter's relationship to the evidence: `source-author`, `device-owner`, `authorized-operator`, or `independent-researcher`. All three authority attestations must be `true`. These are declarations, not verified identity. The JSON deliberately has no contributor name or email field.

`reason` is a closed code, not free text. `propose` requires `new-public-evidence`; `correct` requires `corrected-public-evidence`; `withdraw` requires `accuracy-withdrawal`, `rights-boundary-withdrawal`, or `contributor-withdrawal`. This prevents explanation fields from becoming an uncontrolled channel for sensitive context.

## Claim limits

`sys_object_id` must be a numeric, non-root OID of at most 1,024 characters below `1.3.6.1.4.1.<PEN>`. The PEN and `enterprise_number` must be positive, and `enterprise_number` must equal the PEN arc. Symbolic OIDs are rejected.

Claims use `match_method: exact` or `prefix` and one strength:

| Strength | Required assertion | Constraint |
|---|---|---|
| `exact_model` | `model` | Exact match only; `mib_identifier` must be null. |
| `product_family` | `product_family` | Exact match only; model, MIB identifier, and platform must be null. |
| `vendor_identifier` | `mib_identifier` | Exact match only; model, family, and platform must be null. |
| `platform` | `platform` | Model, family, and MIB identifier must be null. |

Every prefix claim is platform-only. Prefixes cannot assert an exact model, product family, or MIB identifier.

`model`, `product_family`, `mib_identifier`, and `platform` are explicitly nullable. Firmware scope is either:

- `not_established` with no versions; or
- `observed_only` with 1–20 sorted, unique observed versions.

An observed firmware version is evidence of that observation only. It does not prove a general compatibility or support range.

## Field-level evidence

`field_provenance` must contain exactly the normalized claim fields: the five base fields plus each non-null identity field. Every field has 1–8 evidence rows. An evidence row contains only:

- a canonical credential-free HTTPS `source_url` of at most 2,048 characters with no query string or fragment;
- a bounded, pinned `source_revision` rather than a moving branch or “latest” reference;
- the lowercase SHA-256 of the reviewed artifact;
- a real `source_date`;
- a controlled `evidence_type`; and
- the permitted `publication_scope`.

The evidence type and scope must agree. Registry evidence can support registry or factual metadata; vendor documentation can support factual metadata; open-source definitions can support definition output; project fixtures and authorized observations are observation-only. A public URL is not by itself proof of publication rights or claim accuracy.

An evidence `source_date` cannot be later than the contribution event date. This prevents an append-only event from claiming evidence that did not yet exist.

The URL path and `source_revision` are also checked for credential and secret denylist signals. A matching signal is rejected. Passing this filter does not prove that a value is secret-free; contributors and maintainers remain responsible for reviewing the complete public record before it enters Git history.

## Optional sanitized observation

`sanitized_observation` is either `null` or one allowlisted record containing only:

- numeric `sys_object_id`;
- nullable numeric `ent_physical_vendor_type`;
- nullable `ent_physical_model_name`;
- nullable `firmware_version`;
- `observed_at`; and
- the fixed sanitization flags.

`raw_walk_included`, `sys_descr_included`, `credentials_included`, `device_identifiers_included`, and `customer_identifiers_included` must all be `false`. Supplying selected fields does not authorize sending the surrounding walk or device output.

`observation_provenance` is separate from claim provenance. It must contain exactly one key for each non-null observation field, including `sys_object_id` and `observed_at`, with 1–8 evidence rows per field. When the observation is `null`, the map must be empty.

The observation `observed_at` date cannot be later than the contribution event date.

## Maintainer reviews

[`device-identity-contribution-review.schema.json`](../contracts/device-identity-contribution-review.schema.json) defines a strict review. A review binds both `contribution_event_id` and the SHA-256 of the RFC 8785 canonical event value. Changing an event value changes that digest. Pure formatting would not change an RFC 8785 digest, so the separate deterministic-file gate rejects formatting drift before review validation.

Allowed decisions are:

- `approved-evidence` with `reason: evidence-approved-for-scope`;
- `rejected` or `needs-changes` with `reason: insufficient-evidence`, `rights-scope-unclear`, or `sensitive-data-risk`; and
- `withdrawal-acknowledged` with `reason: withdrawal-confirmed`.

Only `approved-evidence` can list sorted `reviewed_fields` and a bounded `approved_publication_scope`. Every reviewed claim field must have at least one evidence row compatible with that scope: registry, factual-metadata, and observation evidence can support `metadata-only`; definition evidence can support `definition-only`. Other decisions carry an empty field list and a null scope. A withdrawal can only receive `withdrawal-acknowledged`.

The reviewer attests as `repository-maintainer` that evidence, rights scope, and sensitive-data boundaries were checked. The review stores no maintainer identity or email. Every review remains `publication_state: quarantine` with `promotion_required: true`; approval is an evidence decision, not publication.

## Ledger cost and deterministic processing

Let `B` be total ledger bytes, `E` event count, `R` review count, and `G` grouped match keys. Validation, canonical hashing, ledger replay, chain checks, hash-index construction, and review binding cost `O(B + E + R)` time. Parsed input retention costs `O(B)` memory and indexes add `O(E + R)`. Report grouping and deterministic sorting add `O(E log E + G log G)` time.

Memory is driven by retained event, review, digest, and mapping indexes. I/O, canonical hashing, and sorting dominate CPU and energy as the ledgers grow. Each deterministic ledger JSON document has a 16 MiB UTF-8 byte limit before parsing. The other fixed limits are 10,000 events, 20,000 reviews, eight evidence rows per field, and twenty observed firmware values.

## Synthetic examples

[`device-identity-contribution-event.json`](../contracts/examples/device-identity-contribution-event.json) and [`device-identity-contribution-review.json`](../contracts/examples/device-identity-contribution-review.json) demonstrate the contract. All evidence uses `example.invalid`, all identifiers and hashes are synthetic, and the records are not live evidence or production data.
