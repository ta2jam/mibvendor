# ADR 0003: Decode raw walk data locally by default

Status: Accepted for prototype; production implementation requires measurement
Date: 2026-07-13

## Decision

The browser parses raw walk text and joins returned OID definitions to values
locally. A future server resolver may receive only bounded batches of numeric
OIDs. Raw values, hostnames, serial numbers, community strings, and credentials
must not be sent, retained, logged, or included in telemetry by default.

The public service never initiates an SNMP connection.

## Rationale

Raw walks commonly contain operational and identifying data. The product needs
OID resolution, not custody of device values. Local parsing reduces privacy,
retention, and breach surface.

## Consequences

- The browser path needs streaming/chunked parsing for large files.
- Phase 3 must measure 10 MiB or 50,000 lines and record time and peak memory.
- Private vendor MIB loading, if demanded, belongs in a local CLI rather than a
  public corpus shortcut.
