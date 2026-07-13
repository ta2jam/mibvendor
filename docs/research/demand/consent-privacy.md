# Research consent and privacy note

Use this short statement before screening artifacts or sessions are collected:

> This research evaluates MIB/OID discovery and decoding workflows. Participation is voluntary. You may skip any question or stop at any time. Do not share passwords, SNMP community strings, authentication keys, customer names, live hostnames/IPs, serial numbers, proprietary MIBs, or unsanitized walk/trap data. We will use a participant ID in research notes. Recording is optional and requires separate consent. The session is product research, not production monitoring advice.

Record separate yes/no consent for:

- Participation and note-taking.
- Audio/screen recording.
- Follow-up contact for repeat-use validation.
- Use of anonymized excerpts in internal/public research summaries.

Declining recording or quotation does not exclude the participant.

## Data handling

- Identity/contact mapping: separate restricted file, never committed to the public repository.
- Research notes: participant ID only; remove employer/customer/device identifiers.
- Recordings: default delete within 30 days after analysis; earlier on request.
- Contact data: delete after incentives/follow-up conclude, no later than 90 days unless the participant separately opts into ongoing contact.
- Sanitized fixtures: store only when the participant confirms redistribution/usage authority; otherwise inspect transiently and do not commit/upload.
- Raw walks: parse locally by default. Do not log raw lines, values, filenames, hostnames, serials, or credentials.
- Telemetry for repeat-use validation: participant code, prototype release, coarse timestamp, task type, completion outcome. No raw query/value payload.
- Access: named research personnel only; no public issue attachments.
- Deletion request: maintain a contact route and participant ID lookup; confirm deletion completion.

## Incident rule

If a participant exposes a secret or customer identifier, stop the session, do not repeat it in notes/chat, delete the capture, notify the participant, and ask them to rotate the exposed secret through their own process. Do not treat accidental disclosure as research data.
