import { canonicalJsonSha256 } from "../scripts/canonical-json.mjs";

const ACTIONS = new Set(["baseline", "promotion", "disable", "enable", "correction", "rollback"]);
const TARGET_TYPES = new Set(["release", "source", "module"]);
const RELEASE_ACTIONS = new Set(["baseline", "promotion", "rollback"]);
const RELEASE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export function isSafePublicationReleaseId(value) {
  return typeof value === "string" && value.length <= 128 && RELEASE_ID_PATTERN.test(value);
}

export function publicationControlEventDigest(event) {
  const { event_sha256: _eventSha256, ...projection } = event;
  return canonicalJsonSha256(projection);
}

export function derivePublicationControlState(events) {
  const disabledSources = new Set();
  const disabledModules = new Set();
  let activeRelease = null;

  for (const event of events) {
    if (RELEASE_ACTIONS.has(event.action) && event.target_type === "release") {
      activeRelease = event.target_id;
      continue;
    }
    if (event.target_type !== "source" && event.target_type !== "module") continue;
    const target = event.target_type === "source" ? disabledSources : disabledModules;
    if (event.action === "disable") target.add(event.target_id);
    if (event.action === "enable") target.delete(event.target_id);
  }

  return { activeRelease, disabledSources, disabledModules };
}

export function appendPublicationPromotion(document, { releaseId, occurredAt, reason, evidenceUrl }) {
  if (!isSafePublicationReleaseId(releaseId)) throw new TypeError("Promotion release ID is unsafe");
  if (typeof occurredAt !== "string" || !Number.isFinite(Date.parse(occurredAt))) {
    throw new TypeError("Promotion timestamp is invalid");
  }
  if (new Date(occurredAt).toISOString().replace(".000Z", "Z") !== occurredAt) {
    throw new TypeError("Promotion timestamp must be a canonical UTC timestamp");
  }
  if (typeof reason !== "string" || !reason.trim()) throw new TypeError("Promotion reason is required");
  if (evidenceUrl !== null && (typeof evidenceUrl !== "string" || !evidenceUrl.startsWith("https://"))) {
    throw new TypeError("Promotion evidence URL must be HTTPS or null");
  }
  if (!Array.isArray(document?.events) || document.events.length === 0) {
    throw new TypeError("Promotion requires an existing publication-control audit log");
  }

  const previous = document.events.at(-1);
  const event = {
    sequence: document.events.length + 1,
    occurred_at: occurredAt,
    action: "promotion",
    target_type: "release",
    target_id: releaseId,
    reason,
    evidence_url: evidenceUrl,
    supersedes_event_sha256: null,
    previous_event_sha256: previous.event_sha256,
    event_sha256: null
  };
  event.event_sha256 = publicationControlEventDigest(event);

  return {
    ...document,
    active_data_release: releaseId,
    updated_at: occurredAt,
    events: [...document.events, event]
  };
}

export function validatePublicationControls(document, { releaseId, sourceIds, moduleIds }) {
  const failures = [];
  if (document?.schema_version !== 1) failures.push("Publication control schema version must be 1");
  if (!isSafePublicationReleaseId(releaseId)) failures.push("Current catalog release ID is unsafe");
  if (!isSafePublicationReleaseId(document?.active_data_release)) failures.push("Publication control active release ID is unsafe");
  if (document?.active_data_release !== releaseId) failures.push("Publication controls target a different active data release");
  if (!Number.isFinite(Date.parse(document?.updated_at))) failures.push("Publication control updated_at is invalid");
  if (!Array.isArray(document?.events) || document.events.length === 0) failures.push("Publication controls require an audit event");

  let previous = null;
  let previousTime = -Infinity;
  const eventHashes = new Set();
  for (const [index, event] of (document?.events ?? []).entries()) {
    if (event.sequence !== index + 1) failures.push(`Publication control event sequence drifted at ${index + 1}`);
    const occurredAt = Date.parse(event.occurred_at);
    if (!Number.isFinite(occurredAt)) failures.push(`Publication control event ${event.sequence} has an invalid time`);
    if (occurredAt < previousTime) failures.push(`Publication control event ${event.sequence} is out of chronological order`);
    if (!ACTIONS.has(event.action)) failures.push(`Publication control event ${event.sequence} has an invalid action`);
    if (!TARGET_TYPES.has(event.target_type)) failures.push(`Publication control event ${event.sequence} has an invalid target type`);
    if (event.previous_event_sha256 !== previous) failures.push(`Publication control event ${event.sequence} broke the hash chain`);
    if (event.previous_event_sha256 !== null && !/^[0-9a-f]{64}$/.test(event.previous_event_sha256)) {
      failures.push(`Publication control event ${event.sequence} has an invalid previous digest`);
    }
    const expectedDigest = publicationControlEventDigest(event);
    if (event.event_sha256 !== expectedDigest) failures.push(`Publication control event ${event.sequence} digest drifted`);
    if (!/^[0-9a-f]{64}$/.test(event.event_sha256 ?? "")) failures.push(`Publication control event ${event.sequence} has an invalid digest`);
    if (event.supersedes_event_sha256 !== null && !eventHashes.has(event.supersedes_event_sha256)) {
      failures.push(`Publication control event ${event.sequence} supersedes an unknown or future event`);
    }
    if (eventHashes.has(event.event_sha256)) failures.push(`Publication control event ${event.sequence} reuses an event digest`);
    eventHashes.add(event.event_sha256);
    if (event.action === "correction" && event.supersedes_event_sha256 === null) {
      failures.push(`Correction event ${event.sequence} must identify the superseded event`);
    }
    if (event.action !== "correction" && event.supersedes_event_sha256 !== null) {
      failures.push(`Only correction events may supersede an earlier event`);
    }
    if (!event.reason?.trim()) failures.push(`Publication control event ${event.sequence} requires a reason`);
    if (event.evidence_url !== null && !event.evidence_url?.startsWith("https://")) {
      failures.push(`Publication control event ${event.sequence} has a non-HTTPS evidence URL`);
    }
    if (event.target_type === "release" && !isSafePublicationReleaseId(event.target_id)) {
      failures.push(`Publication control event ${event.sequence} has an unsafe release target`);
    }
    if (event.target_type === "source" && !sourceIds.has(event.target_id)) failures.push(`Unknown source target ${event.target_id}`);
    if (event.target_type === "module" && !moduleIds.has(event.target_id)) failures.push(`Unknown module target ${event.target_id}`);
    if (RELEASE_ACTIONS.has(event.action) !== (event.target_type === "release")) {
      failures.push(`Publication control event ${event.sequence} has an invalid action/target pair`);
    }
    if (index === 0 && event.action !== "baseline") failures.push("The first publication control event must be a baseline");
    if (event.action === "baseline" && index !== 0) failures.push("Only the first publication control event may be a baseline");
    previous = event.event_sha256;
    previousTime = occurredAt;
  }

  const state = derivePublicationControlState(document?.events ?? []);
  const expectedSources = [...state.disabledSources].sort();
  const expectedModules = [...state.disabledModules].sort();
  if (JSON.stringify(document?.disabled_sources) !== JSON.stringify(expectedSources)) failures.push("Disabled source state differs from the audit log");
  if (JSON.stringify(document?.disabled_modules) !== JSON.stringify(expectedModules)) failures.push("Disabled module state differs from the audit log");
  if (state.activeRelease !== document?.active_data_release) failures.push("Active release state differs from the audit log");
  if (document?.events?.length && document.updated_at !== document.events.at(-1).occurred_at) failures.push("Publication control updated_at differs from the latest event");
  return failures;
}

export function isPublicationEnabled({ sourceId, moduleId }, controls) {
  return !controls.disabledSources.has(sourceId) && !controls.disabledModules.has(moduleId);
}
