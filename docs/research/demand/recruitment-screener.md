# Recruitment screener

Target: 12 completed moderated sessions—4 beginners, 4 experts, 4 API/tool developers. Do not substitute colleagues who have never had a real SNMP/MIB task. Do not count the product owner.

## Recruitment channels

- Monitoring/networking communities where recruitment is permitted.
- Existing professional contacts outside the product team.
- Maintainers/users of Zabbix, LibreNMS, Prometheus SNMP exporter, Observium, or adjacent tooling.
- API/tool developers who have shipped or maintained an SNMP ingestion, exporter, template generator, trap receiver, or MIB parser integration.

Record channel and relationship. Avoid recruiting only from one organization or only from advanced users.

## Questions

1. What is your current role? What monitoring/network tooling do you use?
2. In the last 90 days, did you need to find, understand, translate, validate, or integrate an SNMP OID/MIB? Describe the last case in one sentence.
3. How often did you do this in the last 90 days: never, once, monthly, weekly, or daily?
4. Which artifacts did you personally use: MIB file, numeric walk, symbolic walk, trap, monitoring template, exporter config, API, other?
5. Which tools/sites did you personally use? Do not prompt with mibvendor features.
6. What was the last task’s outcome: completed unaided, completed with help, workaround, abandoned, or still blocked?
7. Rough active time and elapsed time: `<15m`, `15–60m`, `1–4h`, `>4h`, `>1 day`, unknown. Ask for basis, not a forced estimate.
8. Did the task cause a missed alert, incorrect metric, project delay, support escalation, or paid help? Which?
9. Are you able to bring a sanitized real MIB/walk/task? Raw credentials, hostnames, IPs, serials, customer names, and proprietary content must be removed.
10. Have you built or maintained software that consumes MIB/OID data via code in the last 12 months? What shipped?
11. Are you employed by, contracted to, or financially connected with a competing MIB/OID product or with mibvendor?
12. May the session be screen/audio recorded? Declining recording must not exclude participation; notes are sufficient.

## Segment rules

### Beginner — recruit 4

All required:

- ≤18 months of hands-on SNMP/MIB work, or ≤5 completed real MIB/OID tasks.
- At least one real task in the last 90 days.
- Personally attempted the task; not merely managed someone else.

Balance target: at least two who were blocked or needed help, and at least two different monitoring platforms.

### Expert — recruit 4

All required:

- ≥5 years hands-on monitoring/network operations, or ≥50 completed MIB/OID tasks.
- MIB/OID work at least monthly in the last 90 days.
- Can explain scalar vs table and provide a recent example.

Balance target: at least one trap workflow, one table/index workflow, one vendor-private-MIB workflow, and two different monitoring platforms across the group.

### API/tool developer — recruit 4

All required:

- Shipped or maintained code in the last 12 months that consumes numeric OIDs, parses MIBs, decodes walks/traps, generates monitoring config, or exposes related data through an API.
- Can discuss a concrete input/output contract and failure mode.
- At least one integration used beyond a throwaway personal experiment.

Balance target: at least one exporter/config generator, one monitoring-platform integration, and one parser/normalizer or trap/walk decoder across the group.

## Exclude from gate count

- No real task in the relevant recency window.
- Only theoretical SNMP knowledge.
- Product owner/team member.
- Duplicate participants from the same workflow unless they have distinct roles and independent tasks.
- Participant cannot provide informed consent.
- Vendor/competitor conflict that makes normal task disclosure unsafe. Such a person may give expert commentary but does not count toward usability metrics.

## Recruitment record

Use participant IDs only: `B01–B04`, `E01–E04`, `A01–A04`. Store contact details separately from research notes. Track invited, screened, scheduled, completed, excluded reason, consent mode, and incentive. No participant is currently recruited; this document is preparation only.
