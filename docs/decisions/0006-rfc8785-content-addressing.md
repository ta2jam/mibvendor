# ADR 0006: Use RFC 8785 for content-addressed foundation records

Status: Accepted for provisional contracts
Date: 2026-07-14

## Decision

Use the JSON Canonicalization Scheme in RFC 8785 and SHA-256 for deterministic
foundation-record digests. JCS preserves strings without Unicode normalization,
uses ECMAScript primitive serialization, recursively sorts object properties by
raw UTF-16 code units, preserves array order, emits no insignificant whitespace,
and encodes the result as UTF-8.

Reject non-I-JSON inputs, including lone Unicode surrogates, non-finite numbers,
sparse arrays, cycles, accessors, symbol properties, and non-plain objects.

The three self-hash projections are:

- source snapshot: JCS of the root object without `snapshot_id`; the stored ID
  is `src_` plus the lowercase SHA-256;
- canonical module: JCS of the root object without `canonical_sha256`;
- data release: JCS of the root object without `manifest_sha256`.

Nested hashes and identifiers remain in the projection. No Unicode normalization
or array sorting occurs before hashing.

## Consequences

- Equivalent property insertion order produces identical bytes and digests.
- Any semantic field change produces a different enclosing digest.
- Producers in other languages must implement RFC 8785 exactly, including its
  UTF-16 property ordering; ordinary alphabetic or UTF-8 sorting is insufficient.
- Digest construction costs O(n + sum(k log k)) time for n serialized data and k
  keys per object, with O(n + depth) temporary memory.
