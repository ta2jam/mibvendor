<div align="center">

# mibvendor

**Find the right OID, understand its context, and use it with confidence.**

[Open mibvendor](https://mibvendor.io) ·
[Safe use](#use-it-safely) ·
[API status](#api-status)

</div>

mibvendor is a task-first MIB browser and walk decoder for monitoring engineers
and tool developers. Search by numeric OID, symbol, module, or monitoring intent;
then see the table/index meaning, usable command, revision, and source context in
one place.

## Use the web application

The official public alpha is available at [mibvendor.io](https://mibvendor.io).
It currently provides:

- task, symbol, module, and numeric OID search;
- scalar, table, index, enum, access, revision, and source context;
- copy-ready polling guidance;
- browser-local decoding of numeric `snmpwalk` output;
- explicit unresolved results instead of silent guesses.

The current alpha uses a small synthetic and standards-derived demonstration
dataset. It is not yet the production MIB corpus.

## Use it safely

- Use only the official service at `https://mibvendor.io`.
- Never enter an SNMP community string, SNMPv3 credential, device password, API
  secret, or customer identifier into search or walk fields.
- Walk text is decoded inside the browser tab. The current client makes no
  network request for walk decoding and the public service never connects to an
  SNMP device.
- Treat every result according to its visible source, revision, parse status,
  and permitted output scope. A MIB definition does not prove that a specific
  device or firmware implements the object.
- Do not treat third-party mirrors or unofficial API endpoints as mibvendor
  services.

## API status

The public mibvendor API is not released yet. The experimental repository probe
is not a hosted service and is not a supported integration target.

When the API opens, its official versioned origin will be published under
`https://mibvendor.io/v1`. Clients will be expected to send bounded numeric OID
batches—not raw walks, device credentials, hostnames, or serial numbers—and to
pin results to the returned immutable data-release identifier.

No third party is currently authorized to sell API keys or claim an official
mibvendor integration.

## Data trust

Public availability is not redistribution permission. mibvendor reviews
metadata indexing, rendered text, API output, raw download, and bulk export as
separate rights scopes. Unknown-rights vendor material does not enter public
results merely because it can be downloaded elsewhere.

Current validation and data boundaries are published in the
[Phase 0 status](docs/PHASE-0.md) and [product definition](docs/PRODUCT.md).

<div align="center"><sub>The mibvendor application and research foundation are open source on GitHub.</sub></div>
