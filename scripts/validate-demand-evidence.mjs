#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SEGMENTS = new Set(["beginner", "expert", "api-tool-developer"]);
const SCENARIOS = new Set(["H1", "H2", "H3"]);
const PII_KEYS = new Set(["name", "email", "phone", "handle", "company", "hostname", "ip_address"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function scanForPii(value, trail = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert(!PII_KEYS.has(key.toLowerCase()), `${trail}.${key} must not store participant PII`);
    scanForPii(nested, `${trail}.${key}`);
  }
}

function uniqueBy(items, key, label) {
  const seen = new Set();
  for (const item of items) {
    assert(typeof item[key] === "string" && item[key], `${label} has no ${key}`);
    assert(!seen.has(item[key]), `duplicate ${label} ${key}: ${item[key]}`);
    seen.add(item[key]);
  }
  return seen;
}

export function validateDemandEvidence(document) {
  assert(document?.schema_version === 1, "schema_version must be 1");
  for (const field of ["participants", "sessions", "repeat_uses", "api_integrations"]) {
    assert(Array.isArray(document[field]), `${field} must be an array`);
  }
  assert(typeof document.prototype_release === "string" && document.prototype_release, "prototype_release is required");
  scanForPii({
    participants: document.participants,
    sessions: document.sessions,
    repeat_uses: document.repeat_uses,
    api_integrations: document.api_integrations,
  });

  if (document.participants.length) {
    assert(document.consent_notice_approved === true, "participants require an approved consent notice");
    assert(typeof document.research_contact === "string" && document.research_contact, "participants require a research contact route");
  }

  const participantIds = uniqueBy(document.participants, "participant_id", "participant");
  const participantMap = new Map();
  for (const participant of document.participants) {
    assert(SEGMENTS.has(participant.segment), `invalid segment for ${participant.participant_id}`);
    assert(participant.qualified === true, `${participant.participant_id} is not qualified`);
    assert(typeof participant.consent_evidence === "string" && participant.consent_evidence, `${participant.participant_id} has no consent evidence`);
    participantMap.set(participant.participant_id, participant);
  }

  uniqueBy(document.sessions, "session_id", "session");
  const sessionByParticipant = new Map();
  for (const session of document.sessions) {
    assert(participantIds.has(session.participant_id), `${session.session_id} references an unknown participant`);
    assert(validDate(session.session_date), `${session.session_id} has an invalid session_date`);
    assert(session.prototype_release === document.prototype_release, `${session.session_id} used a different prototype release`);
    assert(typeof session.evidence_artifact === "string" && session.evidence_artifact, `${session.session_id} has no evidence artifact`);
    assert(typeof session.material_time_loss === "boolean", `${session.session_id} has no material_time_loss decision`);
    if (session.material_time_loss) {
      assert(Number.isFinite(session.time_loss_minutes) && session.time_loss_minutes > 0, `${session.session_id} has no credible time-loss measurement`);
    }
    assert(!sessionByParticipant.has(session.participant_id), `${session.participant_id} has more than one counted initial session`);
    sessionByParticipant.set(session.participant_id, session);
  }

  uniqueBy(document.repeat_uses, "repeat_id", "repeat use");
  const repeatParticipants = new Set();
  for (const repeat of document.repeat_uses) {
    const initial = sessionByParticipant.get(repeat.participant_id);
    assert(initial, `${repeat.repeat_id} has no initial session`);
    assert(validDate(repeat.repeat_date), `${repeat.repeat_id} has an invalid repeat_date`);
    const elapsedDays = (Date.parse(`${repeat.repeat_date}T00:00:00Z`) - Date.parse(`${initial.session_date}T00:00:00Z`)) / 86400000;
    assert(elapsedDays >= 1 && elapsedDays <= 14, `${repeat.repeat_id} is outside the 1-14 day observation window`);
    assert(repeat.real_task === true, `${repeat.repeat_id} is not a real-task return`);
    assert(typeof repeat.evidence_artifact === "string" && repeat.evidence_artifact, `${repeat.repeat_id} has no evidence artifact`);
    assert(!repeatParticipants.has(repeat.participant_id), `${repeat.participant_id} has duplicate counted repeat use`);
    repeatParticipants.add(repeat.participant_id);
  }

  uniqueBy(document.api_integrations, "integration_id", "API integration");
  const integrationDevelopers = new Set();
  for (const integration of document.api_integrations) {
    assert(SCENARIOS.has(integration.scenario), `${integration.integration_id} has an invalid scenario`);
    assert(typeof integration.external_developer_id === "string" && integration.external_developer_id, `${integration.integration_id} has no external developer ID`);
    assert(typeof integration.code_or_test_artifact === "string" && integration.code_or_test_artifact, `${integration.integration_id} has no code/test artifact`);
    assert(integration.exercised === true, `${integration.integration_id} was not exercised`);
    assert(!integrationDevelopers.has(integration.external_developer_id), `${integration.external_developer_id} has duplicate counted integrations`);
    integrationDevelopers.add(integration.external_developer_id);
  }

  const sessionsBySegment = Object.fromEntries([...SEGMENTS].map((segment) => [segment, 0]));
  let materialLoss = 0;
  for (const session of document.sessions) {
    sessionsBySegment[participantMap.get(session.participant_id).segment] += 1;
    if (session.material_time_loss) materialLoss += 1;
  }

  const gates = {
    sessions_by_segment: sessionsBySegment,
    material_time_loss_users: materialLoss,
    repeat_use_users: repeatParticipants.size,
    external_api_integrations: integrationDevelopers.size,
  };
  gates.passed = Object.values(sessionsBySegment).every((count) => count >= 4)
    && materialLoss >= 5
    && repeatParticipants.size >= 3
    && integrationDevelopers.size >= 3;
  return gates;
}

async function main() {
  const path = process.argv[2] ?? "docs/research/demand/validation-evidence.json";
  const document = JSON.parse(await readFile(path, "utf8"));
  const gates = validateDemandEvidence(document);
  console.log(JSON.stringify(gates, null, 2));
  if (!gates.passed) console.log("demand gate remains open; no missing evidence was inferred");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`demand evidence validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
