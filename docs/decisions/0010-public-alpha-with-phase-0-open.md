# ADR 0010: Operate a public alpha while Phase 0 remains open

Status: Accepted; supersedes parts of ADR 0001 and ADR 0005, and clarifies ADR
0003
Date: 2026-07-20

## Decision

Operate the current task prototype and bounded API as a public, pre-1.0 alpha
without declaring Phase 0 complete or Phase 1 open. Immutable application,
data, and identity releases plus production verification are required for each
deployment. Contracts may still change through explicit prerelease versions;
public operation does not make them stable or prove demand, parser fidelity,
vendor rights, or an SLA.

Raw SNMP walk content remains inside the browser-local workspace. The service
may receive bounded numeric OID lookups and explicit device-identity signals,
including bounded `sysDescr` and model text. The API has no raw-walk,
credential, hostname, or serial-number fields; it does not persist, log, or
echo accepted identity signals. Callers remain responsible for removing any
sensitive substring embedded in supported free-text fields. The service never
initiates SNMP connections.

## Reconciliation

- This supersedes ADR 0001's absolute prohibition on a production runtime and
  its assumption that the prototype must remain disposable.
- This supersedes ADR 0005's prohibition on a public API during Phase 0. Its
  provisional-contract and open-gate conclusions remain in force.
- This confirms ADR 0003's privacy boundary. The previously future bounded
  server resolver now exists, while raw-walk parsing and value joining remain
  browser-local by default.

## Consequences

- Production availability is evidence infrastructure, not evidence that the
  outstanding participant-demand and parser gates passed.
- Server endpoints accept only the minimum structured inputs documented by the
  public API; raw-walk upload is out of scope.
- A public-alpha change needs an immutable release identity, rollback point,
  CI, production probes, and browser verification proportional to UI risk.
