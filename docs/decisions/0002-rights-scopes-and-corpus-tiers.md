# ADR 0002: Treat rights scopes and public corpus tiers independently

Status: Accepted
Date: 2026-07-13

## Decision

Every source is reviewed across five independent scopes: `metadata_index`,
`rendered_text`, `api_output`, `raw_download`, and `bulk_export`.

Public Tier A requires explicit approval for each exposed scope. Public Tier B
contains only fields whose metadata redistribution scope is separately
approved. Unknown-rights material stays in Tier Q or P and produces no public
output.

## Rationale

Public access does not grant redistribution rights. Individual facts may be
unprotected in some jurisdictions while database selection, arrangement,
extraction, or contractual terms remain protected. A blanket metadata exception
is therefore unsafe.

## Consequences

- A source can support QA without entering a public release.
- UI/API/raw/bulk capabilities can differ for the same source.
- Rights expiry or withdrawal fails closed for the affected scope.
