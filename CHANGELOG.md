# Changelog

All notable changes are documented here. The project uses Semantic Versioning
while it is pre-1.0; research releases may remain unstable.

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

[0.1.0-alpha.7]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.7
[0.1.0-alpha.6]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.6
[0.1.0-alpha.5]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.5
[0.1.0-alpha.4]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.4
[0.1.0-alpha.3]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.1
