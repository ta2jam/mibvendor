import test from "node:test";
import assert from "node:assert/strict";
import { validateDemandEvidence } from "../scripts/validate-demand-evidence.mjs";

function completeEvidence() {
  const participants = [];
  const sessions = [];
  for (const segment of ["beginner", "expert", "api-tool-developer"]) {
    for (let index = 1; index <= 4; index += 1) {
      const participantId = `${segment}-${index}`;
      participants.push({ participant_id: participantId, segment, qualified: true, consent_evidence: `vault:consent/${participantId}` });
      sessions.push({
        session_id: `session-${participantId}`,
        participant_id: participantId,
        session_date: "2026-07-01",
        prototype_release: "0.1.0-alpha.test",
        evidence_artifact: `vault:score/${participantId}`,
        material_time_loss: segment === "beginner" || (segment === "expert" && index === 1),
        time_loss_minutes: 120,
      });
    }
  }
  return {
    schema_version: 1,
    research_contact: "https://example.invalid/research-contact",
    consent_notice_approved: true,
    prototype_release: "0.1.0-alpha.test",
    participants,
    sessions,
    repeat_uses: [1, 2, 3].map((index) => ({
      repeat_id: `repeat-${index}`,
      participant_id: `beginner-${index}`,
      repeat_date: "2026-07-08",
      real_task: true,
      evidence_artifact: `vault:repeat/${index}`,
    })),
    api_integrations: [1, 2, 3].map((index) => ({
      integration_id: `integration-${index}`,
      external_developer_id: `developer-${index}`,
      scenario: `H${index}`,
      exercised: true,
      code_or_test_artifact: `commit:integration-${index}`,
    })),
  };
}

test("empty evidence is valid but does not pass the demand gate", () => {
  const gates = validateDemandEvidence({
    schema_version: 1,
    research_contact: null,
    consent_notice_approved: false,
    prototype_release: "0.1.0-alpha.3",
    participants: [], sessions: [], repeat_uses: [], api_integrations: [],
  });
  assert.equal(gates.passed, false);
  assert.equal(gates.external_api_integrations, 0);
});

test("complete independent evidence passes every gate", () => {
  assert.equal(validateDemandEvidence(completeEvidence()).passed, true);
});

test("participant evidence is rejected without consent governance", () => {
  const evidence = completeEvidence();
  evidence.consent_notice_approved = false;
  assert.throws(() => validateDemandEvidence(evidence), /approved consent notice/);
});

test("duplicate external developer evidence cannot inflate the integration gate", () => {
  const evidence = completeEvidence();
  evidence.api_integrations[2].external_developer_id = "developer-2";
  assert.throws(() => validateDemandEvidence(evidence), /duplicate counted integrations/);
});

test("participant PII keys are rejected from the public evidence register", () => {
  const evidence = completeEvidence();
  evidence.participants[0].email = "person@example.invalid";
  assert.throws(() => validateDemandEvidence(evidence), /must not store participant PII/);
});
