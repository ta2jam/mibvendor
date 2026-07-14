# Changelog

All notable changes are documented here. The project uses Semantic Versioning
while it is pre-1.0; research releases may remain unstable.

## [0.1.0-alpha.13] - 2026-07-14

### Fixed

- Synchronized the scheduled production monitor with the new immutable
  `alpha-intelligence-2026-07-14.1` data release and added a repository drift
  assertion so a stale monitor expectation fails before publication.

## [0.1.0-alpha.12] - 2026-07-14

### Added

- Released the bounded public-alpha API at `https://mibvendor.io/v1` with
  same-origin CORS, RFC 9457 failures, immutable data-release identity, and a
  120-request-per-minute in-memory protective limit.
- Added a contact-free 66,266-record IANA Private Enterprise Number snapshot
  with upstream date, retrieval time, SHA-256, CC0 provenance, and a
  reproducible refresh command.
- Added exact rights-approved Net-SNMP `sysObjectID` agent-platform mappings;
  unsupported enterprise OIDs return `enterprise_only` rather than invented
  products or models.
- Added structured object syntax, access, status, descriptions, constraints,
  units, enums, table/row/index relations, and notification objects.
- Added direct, transitive, missing, and cyclic module-dependency response
  fields plus interactive PEN, `sysObjectID`, and dependency lookup cards.
- Published the live OpenAPI 3.1 contract and third-party data notices.

### Changed

- Replaced the static nginx runtime with a pinned, dependency-free Node.js
  modular monolith serving the existing UI and API from the same isolated
  loopback-bound container.
- Updated the README, product definition, Phase 0 evidence boundary, roadmap,
  release contract, mini API documentation, and production verification for
  the public-alpha service.

## [0.1.0-alpha.11] - 2026-07-14

### Added

- Added a compact Developer API Preview below the primary web and walk-decoder
  workflows without promoting API content into the first viewport.
- Documented the four core proposed endpoints, immutable release behavior,
  order-preserving batch semantics, distinct invalid/not-found states, RFC 9457
  errors, experimental limits, and prohibited sensitive inputs.
- Added a synthetic request/response example and a clearly labeled link to the
  OpenAPI research contract.

### Changed

- Kept the unreleased API visibly non-runnable: no production curl command, API
  key claim, authentication promise, rate-limit promise, or availability SLA is
  shown.

## [0.1.0-alpha.10] - 2026-07-14

### Added

- Added ranked search-result navigation that keeps match reason, module, kind,
  and numeric OID visible instead of silently selecting one result.
- Added explicit invalid-OID, valid-but-unknown-OID, empty-query, and text
  no-match states.
- Added visible instance suffix, table/row/index guidance, enum meanings,
  provenance, rights scope, parse status, immutable data release, and device
  verification boundaries to object results.
- Added machine-checked coverage accounting for all 20 UX golden tasks: 11
  implemented, 5 partial, and 4 not implemented.

### Fixed

- Corrected table-column guidance that incorrectly described indexed rows as
  scalar instances.
- Preserved keyboard focus when selecting a different ranked result.

## [0.1.0-alpha.9] - 2026-07-14

### Added

- Added a dependency-free RFC 8785 JSON canonicalizer with strict I-JSON input
  rejection and SHA-256 helpers.
- Added exact content-address projections for source snapshots, canonical
  modules, and immutable data-release manifests.
- Added official ordering/serialization vectors and mutation tests proving that
  stale hashes fail validation.

### Changed

- Replaced placeholder fixture hashes with reproducible content-derived hashes
  and made cross-document source records exact rather than merely referential.

## [0.1.0-alpha.8] - 2026-07-14

### Added

- Added provisional, parser-neutral contracts for immutable source snapshots,
  canonical modules, immutable data releases, the mutable active-release
  pointer, and parser adapter results.
- Added 20 machine-checked UX golden tasks across beginner, expert, and
  API/tool-developer workflows.
- Added dependency-free schema and semantic validation covering rights
  fail-closed behavior, OID consistency, stable references, release counts,
  parser failure boundaries, and cross-document integrity.

### Changed

- Documented source governance, release/rollback semantics, and parser-adapter
  isolation while explicitly keeping Phase 0 open and production scaffolding
  blocked.

## [0.1.0-alpha.7] - 2026-07-14

### Added

- Added a private 100-case corpus intake gate that verifies category balance,
  unique files/content, source membership, testing authority evidence, hashes,
  path containment, and size limits without emitting MIB or evidence contents.
- Added a machine-checked OpenAPI 3.1 contract for the local-only synthetic API
  probe, including explicit prototype rights and data-release boundaries.

### Changed

- Excluded private corpus and result material from parser Docker build contexts,
  with a runtime canary that fails if private material enters an image layer.
- Made the synthetic API probe reject mismatched releases, invalid item types,
  oversized bodies, and overlong queries with stable problem responses.

## [0.1.0-alpha.6] - 2026-07-14

### Added

- Added a native Linux arm64 parser reproduction workflow and committed its
  public provenance and measurements.
- Added a cross-architecture validator proving identical normalized evidence on
  Linux amd64 and arm64 for all three provisional parser candidates.

## [0.1.0-alpha.5] - 2026-07-13

### Fixed

- Isolated the host health service from the deploy user's Docker client
  configuration, removing a harmless but recurring `ProtectHome` warning.

## [0.1.0-alpha.4] - 2026-07-13

### Added

- Added an independent scheduled GitHub production monitor and a hardened
  five-minute VPS health timer with release, container, loopback, Caddy, public
  endpoint, and disk-threshold checks.
- Added a privacy-minimized, machine-validated demand evidence register for
  sessions, material loss, repeat use, and external API integrations.
- Added a ten-vendor first-wave permission tracker, five-scope integrity
  validation, and accountable-identity request renderer.
- Added a real pinned-container Linux amd64 parser result with image, CPU, RSS,
  malformed-input, and determinism measurements.

### Fixed

- Made parser containers write results with the invoking UID/GID and supplied a
  deterministic non-root identity environment, preventing root-owned output and
  PySMI failures on arbitrary host UIDs.

## [0.1.0-alpha.3] - 2026-07-13

### Changed

- Moved the public alpha from GitHub Pages to the dedicated `mibvendor.io`
  production origin on the shared VPS.
- Added a pinned, non-root, read-only static runtime bound only to
  `127.0.0.1:3001`, with explicit health and version endpoints.
- Added container resource, process, capability, logging, and network limits.
- Added a versioned host-Caddy site definition with strict browser security
  headers and a localhost-only upstream.
- Removed the GitHub Pages deployment workflow and all public Pages links.
- Updated CI to current Node 24-compatible official GitHub actions.

## [0.1.0-alpha.2] - 2026-07-13

### Changed

- Reframed the top-level README around using the hosted mibvendor service
  safely; removed local setup, self-hosting-adjacent, and API mock instructions.
- Added prominent safe-use boundaries for browser-local walk decoding, official
  origins, device credentials, source/revision confidence, and future API use.
- Added a small open-source attribution to the README and public web footer.
- Polished the public alpha copy and trust presentation without implying that
  the production corpus or public API is already released.

## [0.1.0-alpha.1] - 2026-07-13

### Added

- Phase 0 demand-validation package with 41 desk-research tasks and explicit
  0/12 interview, 0/5 material-loss, 0/3 repeat-use, and 0/3 integration status.
- A 22-source rights matrix: narrow IETF/IANA seed only; no vendor source is
  currently approved for public Tier A/B output.
- Reproducible parser bake-off harness and real nine-case local baseline. PySMI
  is provisional; the required 100-case/container gate remains open.
- A dependency-free task prototype for search, object context, and local walk
  decoding.
- Explicit Phase 0 gates; unmet interview, repeat-use, permission, and runtime
  evidence cannot be marked complete.
- Repository checks and CI without production MIB data.

[0.1.0-alpha.13]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.13
[0.1.0-alpha.12]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.12
[0.1.0-alpha.11]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.11
[0.1.0-alpha.10]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.10
[0.1.0-alpha.9]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.9
[0.1.0-alpha.8]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.8
[0.1.0-alpha.7]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.7
[0.1.0-alpha.6]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.6
[0.1.0-alpha.5]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.5
[0.1.0-alpha.4]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.4
[0.1.0-alpha.3]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.1
