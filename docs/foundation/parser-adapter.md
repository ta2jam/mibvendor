# Parser adapter contract

Status: provisional; canonical parser gate open

Parser adapters translate bounded source artifacts into the project-owned
canonical module. Application code must not depend on PySMI, libsmi, Net-SNMP,
or another parser's raw JSON shape.

An adapter receives an immutable source snapshot identifier, artifact hash, and
optional module hint. It returns one envelope containing adapter identity,
outcome, canonical output or null, normalized diagnostics, and measured wall,
CPU, and peak-memory values.

Required boundaries:

- no network access during parsing;
- fixed input-size, wall-time, memory, process, and output-size limits;
- deterministic normalized output for identical input and adapter version;
- failure returns no partial canonical module and at least one error diagnostic;
- success returns a canonical module and no error diagnostic;
- diagnostics contain codes and locations, but no raw third-party text, local
  absolute paths, credentials, or customer data;
- parser upgrades are measured against the rights-approved corpus before use.

The current parser recommendation remains provisional. Replacing it must not
change the canonical or API contract unless evidence requires a versioned
migration.
