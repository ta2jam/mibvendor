# Changelog

All notable changes are documented here. The project uses Semantic Versioning
while it is pre-1.0; research releases may remain unstable.

## [0.4.0-alpha.1] - 2026-07-20

### Added

- Added immutable `device-identity-2026-07-20.1` data with 6,199 exact
  vendor-MIB OID assignments across ten vendor families: 36 narrow reviewed
  device-model normalizations, 1,491 product-family/category assignments, and
  4,672 generic vendor MIB identifiers that assert neither model nor family.
- Added 1,023 sanitized LibreNMS and SNMP::Info fixture observations over 713
  exact OIDs as a separate corroboration layer; 72 conflicting observation OIDs
  remain explicit and no raw walk or private device field is retained.
- Added direct PEN and nullable reviewed `organization_key` fields. Seven exact
  MAC–PEN organization links are pinned to the public macvendor snapshot; no
  key is synthesized from a name or PEN.
- Added `POST /v1/device-identities:assess` for bounded correlation of
  `sysObjectID`, `entPhysicalVendorType`, `entPhysicalModelName`, and narrow
  `sysDescr` platform signatures, with deterministic conflict handling and
  `no-store` responses.
- Added a responsive device-identity workbench, evidence-layer presentation,
  Catalyst 9300 positive/negative/conflict examples, and full OpenAPI schemas.
- Added a release-manifest digest and a separately hashed, revisioned
  publication-control view with per-source kill switches; responses expose the
  effective `identity_view` so control changes do not masquerade as immutable
  release changes.

### Changed

- Replaced the former Cisco-wide rights denial with metadata-only factual OID
  assignments. Artifact-specific restrictions still block raw MIB text and
  descriptions.
- Separated application version, MIB `data_release`, and `identity_release` in
  status, version, API, image labels, monitoring, and production verification.
- Preserved legacy `sysObjectID` response fields while distinguishing
  `exact_model`, `product_family`, `vendor_identifier`, `platform`, `vendor_only`,
  `conflicting_evidence`, and `unknown` outcomes.
- Added explicit `firmware_scope: "not_established"` to singular identity
  results and candidates; unknown or conflicting results use `null` rather than
  implying firmware-wide support.

### Security

- Rejects raw walks, arrays, extra fields, unsupported media, oversized bodies,
  and out-of-bound identity signals. Raw `sysDescr` is neither returned nor
  stored, candidate/conflict output is capped at 32, and an assessment consumes
  four fair-use units.
- Rejects compact, colon-, hyphen-, and dot-form MAC-like values from sanitized
  model observations. Manifest-controlled fixture paths cannot escape their
  pinned roots.
- Binds retained LibreNMS and SNMP::Info license evidence into the runtime index,
  immutable release digest, and startup validation. Source kill switches also
  recompute effective conflicts and cannot resurrect reviewed model claims.
- Exposes ETag, fair-use, retry, and raw-archive integrity headers to permitted
  cross-origin API clients.

## [0.3.0-alpha.2] - 2026-07-20

### Added

- Expanded the active license-signaled corpus from 110 to 702 raw modules and
  from 5,392 to 76,606 parsed OID nodes, with 4,138 textual conventions and
  1,273 notifications reported separately.
- Added deterministic repository-license discovery, pinned intake, parser,
  dependency-closure, case-folded public-ID collision, release-evidence,
  correction, and publication-control gates.
- Added routable object, module, enterprise, `sysObjectID`, search, and release
  views plus bounded ancestor, direct-child, and subtree navigation APIs.
- Added one evidence-backed SigScale OCS platform mapping. It remains an exact
  OID/platform claim with `model: null`, not a hardware-model assertion.
- Added a permanently free API decision, strong ETags, conditional GETs,
  copyable curl/JavaScript/Python examples, and explicit fair-use boundaries.
- Added deterministic raw-MIB TAR downloads that retain the applicable license
  or notice and provenance; active raw routes revalidate withdrawal controls.

### Changed

- Replaced per-request search normalization with a retained normalized index;
  the 76,606-object candidate measured 16.669 ms text-search p95 and 316.91 MiB
  peak RSS under the documented local benchmark.
- Marked body-dependent batch POST responses `no-store` so shared caches cannot
  reuse a result across different request bodies.
- Superseded six synthetic API records with their active parsed catalog rows,
  preserving task-intent metadata while exposing redistributable provenance,
  table/row/index context, and instance-safe numeric resolution.
- Increased the production container memory limit from 192 MiB to 640 MiB for
  the measured corpus while keeping the database-free, dependency-light Node
  runtime and loopback-only service boundary.

### Fixed

- Aligned CI with the production Node 22 runtime and the measured 640 MiB
  cgroup limit; the search gate now enforces both observed RSS and the process
  lifetime high water mark.
- Preserved the byte-identical data-release activation record across later
  application releases and bound its activating version to the promotion tag.
- Updated production verification for the licensed TAR download contract,
  including exact archive, MIB, license, and provenance checksum checks.

## [0.3.0-alpha.1] - 2026-07-20

### Not deployed

- The immutable tag failed its CI memory gate on GitHub's Node 24/x64 runner
  and was superseded before a GitHub Release or VPS deployment. The corrected
  gate uses the measured 640 MiB production limit and also checks process
  lifetime high-water RSS.

## [0.2.0-alpha.1] - 2026-07-14

### Added

- Added a fail-closed four-mode source policy: `redistributable`,
  `metadata-only`, `directory-only`, and `quarantine`.
- Added 110 manifest-bound redistributable MIB modules: 72 file-reviewed IETF,
  all 20 IANA-maintained MIBs, and 18 pinned Net-SNMP project modules.
- Added 5,392 parsed OID nodes with syntax, access, status, description,
  revision, dependencies, source and artifact SHA-256, and license provenance.
- Added module/source catalog APIs and raw download responses with checksum,
  license, and original-source headers.
- Added a website MIB catalog, publication-mode explanation, and full-corpus
  primary OID search.
- Added deterministic catalog validation for paths, checksums, notices, scope
  approval, source completeness, and unmanifested raw files.

### Changed

- Reclassified the six pre-existing, independently authored legacy-standard
  records as metadata-only with raw download disabled.
- Quarantined 14 IETF candidate RFCs whose required code-component notice was
  not established, and kept all reviewed vendor content outside public output.
- Updated README, website API docs, OpenAPI 3.1, source governance, Phase 0,
  roadmap, release contract, and third-party notices for the new data release.

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

[0.4.0-alpha.1]: https://github.com/ta2jam/mibvendor/releases/tag/v0.4.0-alpha.1
[0.3.0-alpha.2]: https://github.com/ta2jam/mibvendor/releases/tag/v0.3.0-alpha.2
[0.3.0-alpha.1]: https://github.com/ta2jam/mibvendor/releases/tag/v0.3.0-alpha.1
[0.2.0-alpha.1]: https://github.com/ta2jam/mibvendor/releases/tag/v0.2.0-alpha.1
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
