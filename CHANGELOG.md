# Changelog

All notable changes are documented here. The project uses Semantic Versioning
while it is pre-1.0; research releases may remain unstable.

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

[0.1.0-alpha.2]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/ta2jam/mibvendor/releases/tag/v0.1.0-alpha.1
