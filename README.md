<div align="center">

# mibvendor

**A task-first, source-aware MIB browser, walk decoder, and API.**

</div>

> [!WARNING]
> This repository is in Phase 0 validation. The prototype uses synthetic and
> standards-derived mock records; it is not a production MIB corpus or parser.

mibvendor is being designed for monitoring engineers and tool developers who
need to resolve OIDs, understand table/index semantics, decode existing
`snmpwalk` output, and cite the exact source revision behind a result.

The product claim is not "a prettier MIB tree." The claims under test are:

1. task-oriented resolution is materially faster than browsing module trees;
2. local-first walk decoding removes a recurring manual interpretation cost;
3. revision and provenance metadata are useful enough to become an API
   contract, not decoration.

These claims are unproven until the gates in [Phase 0](docs/PHASE-0.md) pass.

## Research prototype

```bash
npm run serve:prototype
```

Open <http://localhost:4173>. The prototype has no runtime dependencies and no
network calls. Walk text stays in the browser process.

Three API integration hypotheses can be exercised against a synthetic, local
contract probe:

```bash
npm run serve:api-mock
```

The probe at <http://127.0.0.1:4010> is deliberately non-production and returns
only the six mock objects used by the browser prototype. It exists to expose
contract gaps during Phase 0 interviews.

## Verification

```bash
npm run verify
```

## Repository boundaries

- Application code is MIT-licensed.
- No third-party vendor MIB is bundled merely because it is publicly reachable.
- Rights are reviewed independently for metadata indexing, rendered text, API
  output, raw download, and bulk export.
- Unknown-rights material is QA/private input, not public output.
- The public service will never connect to an SNMP device.

See [product definition](docs/PRODUCT.md), [roadmap](docs/ROADMAP.md), and the
[research index](docs/research/README.md). Work requiring the repository owner's
identity, participants, vendor permission, or Cloudflare access is tracked in
the [owner action register](docs/ACTIONS.md). The repository's binding
commit/tag/CI/VPS synchronization meaning of `prod'a al` is defined in the
[release contract](docs/RELEASE.md).
