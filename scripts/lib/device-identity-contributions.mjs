import { canonicalJsonSha256 } from "../canonical-json.mjs";

export const MAX_CONTRIBUTION_EVENTS = 10_000;
export const MAX_CONTRIBUTION_REVIEWS = 20_000;
export const MAX_CONTRIBUTION_DOCUMENT_BYTES = 16 * 1024 * 1024;

export const CONTRIBUTION_POLICY = Object.freeze({
  publication_state: "quarantine",
  automatic_publication: false,
  raw_walks_allowed: false,
  sensitive_values_allowed: false,
  review_required: true,
  promotion_required: true
});

const EVENT_DOCUMENT_KEYS = new Set(["schema_version", "policy", "events"]);
const POLICY_KEYS = new Set(Object.keys(CONTRIBUTION_POLICY));
const EVENT_KEYS = new Set([
  "schema_version",
  "event_id",
  "event_type",
  "occurred_at",
  "mapping_id",
  "supersedes_event_id",
  "authority",
  "claim",
  "field_provenance",
  "sanitized_observation",
  "observation_provenance",
  "reason"
]);
const AUTHORITY_KEYS = new Set([
  "relationship",
  "attests_right_to_submit",
  "attests_no_sensitive_data",
  "attests_public_contribution"
]);
const CLAIM_KEYS = new Set([
  "sys_object_id",
  "enterprise_number",
  "match_method",
  "claim_strength",
  "model",
  "product_family",
  "mib_identifier",
  "platform",
  "firmware_scope"
]);
const FIRMWARE_KEYS = new Set(["status", "observed_versions"]);
const EVIDENCE_KEYS = new Set([
  "source_url",
  "source_revision",
  "artifact_sha256",
  "source_date",
  "evidence_type",
  "publication_scope"
]);
const OBSERVATION_KEYS = new Set([
  "sys_object_id",
  "ent_physical_vendor_type",
  "ent_physical_model_name",
  "firmware_version",
  "observed_at",
  "sanitization"
]);
const SANITIZATION_KEYS = new Set([
  "raw_walk_included",
  "sys_descr_included",
  "credentials_included",
  "device_identifiers_included",
  "customer_identifiers_included"
]);
const REVIEW_DOCUMENT_KEYS = new Set(["schema_version", "reviews"]);
const REVIEW_KEYS = new Set([
  "schema_version",
  "review_id",
  "occurred_at",
  "contribution_event_id",
  "contribution_event_sha256",
  "mapping_id",
  "decision",
  "reviewed_fields",
  "approved_publication_scope",
  "reason",
  "reviewer_attestation",
  "publication_state",
  "promotion_required"
]);
const REVIEWER_KEYS = new Set([
  "role",
  "evidence_reviewed",
  "rights_scope_reviewed",
  "sensitive_data_reviewed"
]);

const EVENT_ID = /^contrib-(\d{8}T\d{6}Z)-[0-9a-f]{12}$/u;
const REVIEW_ID = /^review-(\d{8}T\d{6}Z)-[0-9a-f]{12}$/u;
const MAPPING_ID = /^mapping-[a-z0-9][a-z0-9-]{2,63}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const ENTERPRISE_OID = /^1\.3\.6\.1\.4\.1\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))+$/u;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._+()\/:&-]{0,127}$/u;
const MIB_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:+\/-]{6,127}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const SENSITIVE_TEXT = [
  /@/u,
  /\b(?:api[ _-]?key|token|private[ _-]?key|password|secret|community(?:[ _-]?string)?)\b/iu,
  /\b(?:serial(?:\s+number)?|s\/n|hostname|contact|location)\b/iu,
  /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/iu,
  /\b[0-9A-F]{4}(?:\.[0-9A-F]{4}){2}\b/iu,
  /\b[0-9A-F]{12}\b/iu,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
  /\b(?:[0-9A-F]{1,4}:){2,}[0-9A-F:]{0,39}\b/iu,
  /\b[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\b/iu,
  CONTROL
];
const SENSITIVE_VALUE = [/(?:https?|ftp):\/\//iu, ...SENSITIVE_TEXT];

const RELATIONSHIPS = new Set([
  "source-author",
  "device-owner",
  "authorized-operator",
  "independent-researcher"
]);
const MATCH_METHODS = new Set(["exact", "prefix"]);
const CLAIM_STRENGTHS = new Set(["exact_model", "product_family", "vendor_identifier", "platform"]);
const EVIDENCE_TYPES = new Set([
  "official-registry",
  "vendor-documentation",
  "open-source-definition",
  "project-fixture",
  "authorized-observation"
]);
const PUBLICATION_SCOPES = new Set([
  "registry",
  "factual-metadata-only",
  "definition-only",
  "observation-only"
]);
const REVIEW_DECISIONS = new Set([
  "approved-evidence",
  "rejected",
  "needs-changes",
  "withdrawal-acknowledged"
]);
const REVIEW_SCOPES = new Set(["metadata-only", "definition-only"]);
const REVIEW_SCOPE_EVIDENCE = Object.freeze({
  "metadata-only": new Set(["registry", "factual-metadata-only", "observation-only"]),
  "definition-only": new Set(["definition-only"])
});
const EVENT_REASONS = Object.freeze({
  propose: new Set(["new-public-evidence"]),
  correct: new Set(["corrected-public-evidence"]),
  withdraw: new Set(["accuracy-withdrawal", "rights-boundary-withdrawal", "contributor-withdrawal"])
});
const REVIEW_REASONS = Object.freeze({
  "approved-evidence": new Set(["evidence-approved-for-scope"]),
  rejected: new Set(["insufficient-evidence", "rights-scope-unclear", "sensitive-data-risk"]),
  "needs-changes": new Set(["insufficient-evidence", "rights-scope-unclear", "sensitive-data-risk"]),
  "withdrawal-acknowledged": new Set(["withdrawal-confirmed"])
});

export class DeviceIdentityContributionError extends Error {
  constructor(issues) {
    super(issues.join("; "));
    this.name = "DeviceIdentityContributionError";
    this.issues = Object.freeze([...issues]);
  }
}

export function parseDeterministicContributionJson(source, label = "contribution JSON") {
  if (typeof source !== "string") throw new TypeError(`${label} source must be text`);
  if (Buffer.byteLength(source, "utf8") > MAX_CONTRIBUTION_DOCUMENT_BYTES) {
    throw new DeviceIdentityContributionError([
      `${label} exceeds the ${MAX_CONTRIBUTION_DOCUMENT_BYTES}-byte contribution document limit`
    ]);
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new DeviceIdentityContributionError([`${label} is not valid JSON`]);
  }
  let deterministic;
  try {
    deterministic = `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    throw new DeviceIdentityContributionError([`${label} exceeds the supported JSON nesting depth`]);
  }
  if (deterministic !== source) {
    throw new DeviceIdentityContributionError([
      `${label} must use deterministic two-space JSON with one trailing newline and no duplicate object keys`
    ]);
  }
  return value;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label, issues) {
  if (!plainObject(value)) {
    issues.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value);
  const missing = [...expected].filter((key) => !Object.hasOwn(value, key));
  const extra = actual.filter((key) => !expected.has(key));
  if (missing.length) issues.push(`${label} is missing fields: ${missing.join(", ")}`);
  if (extra.length) issues.push(`${label} has unknown fields: ${extra.join(", ")}`);
  return missing.length === 0 && extra.length === 0;
}

function validDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validUtcSeconds(value) {
  if (typeof value !== "string" || !UTC_SECONDS.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().replace(".000Z", "Z") === value;
}

function compactTimestamp(value) {
  return value.replace(/[-:]/gu, "");
}

function safeOid(value) {
  if (typeof value !== "string" || value.length > 1_024 || !ENTERPRISE_OID.test(value)) return false;
  const parts = value.split(".");
  if (parts.length < 8 || parts.length > 128 || Number(parts[6]) < 1) return false;
  return parts.every((part) => {
    const arc = Number(part);
    return Number.isSafeInteger(arc) && arc >= 0 && arc <= 0xffffffff;
  });
}

function safeLabel(value, pattern = LABEL) {
  return typeof value === "string"
    && pattern.test(value)
    && !SENSITIVE_VALUE.some((rule) => rule.test(value));
}

function hasSensitiveTextSignal(value) {
  return typeof value !== "string" || SENSITIVE_TEXT.some((rule) => rule.test(value));
}

function decodedPathVariants(pathname) {
  const variants = [pathname];
  let current = pathname;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      variants.push(decoded);
      current = decoded;
    } catch {
      return null;
    }
  }
  return variants;
}

function validatePolicy(policy, issues) {
  exactKeys(policy, POLICY_KEYS, "events.policy", issues);
  for (const [key, expected] of Object.entries(CONTRIBUTION_POLICY)) {
    if (policy?.[key] !== expected) issues.push(`events.policy.${key} must remain ${JSON.stringify(expected)}`);
  }
}

function validateAuthority(authority, label, issues) {
  if (!exactKeys(authority, AUTHORITY_KEYS, label, issues)) return;
  if (!RELATIONSHIPS.has(authority.relationship)) issues.push(`${label}.relationship is unsupported`);
  for (const key of ["attests_right_to_submit", "attests_no_sensitive_data", "attests_public_contribution"]) {
    if (authority[key] !== true) issues.push(`${label}.${key} must be true`);
  }
}

function validateSourceEvidence(evidence, label, issues, notAfter) {
  const initialIssueCount = issues.length;
  if (!exactKeys(evidence, EVIDENCE_KEYS, label, issues)) return false;
  let parsed;
  if (typeof evidence.source_url !== "string" || evidence.source_url.length > 2_048) {
    issues.push(`${label}.source_url must be a string of at most 2048 characters`);
  } else try {
    parsed = new URL(evidence.source_url);
  } catch {
    issues.push(`${label}.source_url must be a valid URL`);
  }
  if (parsed && (
    parsed.protocol !== "https:"
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.href !== evidence.source_url
  )) {
    issues.push(`${label}.source_url must be canonical credential-free HTTPS without query or fragment`);
  }
  if (parsed) {
    const pathVariants = decodedPathVariants(parsed.pathname);
    if (!pathVariants || hasSensitiveTextSignal(parsed.hostname)
      || pathVariants.some((value) => hasSensitiveTextSignal(value))) {
      issues.push(`${label}.source_url contains a forbidden sensitive-data signal`);
    }
  }
  if (!REVISION.test(evidence.source_revision ?? "") || CONTROL.test(evidence.source_revision ?? "")) {
    issues.push(`${label}.source_revision is invalid or unbounded`);
  } else if (SENSITIVE_VALUE.some((rule) => rule.test(evidence.source_revision))) {
    issues.push(`${label}.source_revision contains a forbidden sensitive-data signal`);
  }
  if (!SHA256.test(evidence.artifact_sha256 ?? "")) issues.push(`${label}.artifact_sha256 must be lowercase SHA-256`);
  if (!validDate(evidence.source_date)) issues.push(`${label}.source_date must be a real YYYY-MM-DD date`);
  else if (notAfter && evidence.source_date > notAfter) issues.push(`${label}.source_date cannot postdate its contribution event`);
  if (!EVIDENCE_TYPES.has(evidence.evidence_type)) issues.push(`${label}.evidence_type is unsupported`);
  if (!PUBLICATION_SCOPES.has(evidence.publication_scope)) issues.push(`${label}.publication_scope is unsupported`);
  const allowedScopes = {
    "official-registry": new Set(["registry", "factual-metadata-only"]),
    "vendor-documentation": new Set(["factual-metadata-only"]),
    "open-source-definition": new Set(["definition-only"]),
    "project-fixture": new Set(["observation-only"]),
    "authorized-observation": new Set(["observation-only"])
  };
  if (allowedScopes[evidence.evidence_type] && !allowedScopes[evidence.evidence_type].has(evidence.publication_scope)) {
    issues.push(`${label} combines incompatible evidence_type and publication_scope`);
  }
  return issues.length === initialIssueCount;
}

function expectedClaimProvenanceFields(claim) {
  if (!plainObject(claim)) return [];
  const fields = ["sys_object_id", "enterprise_number", "match_method", "claim_strength", "firmware_scope"];
  for (const key of ["model", "product_family", "mib_identifier", "platform"]) {
    if (claim[key] !== null && claim[key] !== undefined) fields.push(key);
  }
  return fields.sort();
}

function expectedObservationProvenanceFields(observation) {
  if (!plainObject(observation)) return [];
  return ["sys_object_id", "ent_physical_vendor_type", "ent_physical_model_name", "firmware_version", "observed_at"]
    .filter((key) => observation[key] !== null && observation[key] !== undefined)
    .sort();
}

function validateProvenanceMap(provenance, expectedFields, label, issues, notAfter) {
  if (!plainObject(provenance)) {
    issues.push(`${label} must be an object`);
    return;
  }
  const actual = Object.keys(provenance).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedFields)) {
    issues.push(`${label} fields must exactly match normalized fields (${expectedFields.join(", ")})`);
  }
  for (const field of actual) {
    const evidence = provenance[field];
    if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 8) {
      issues.push(`${label}.${field} must contain 1-8 evidence rows`);
      continue;
    }
    const seen = new Set();
    for (const [index, row] of evidence.entries()) {
      const validEvidence = validateSourceEvidence(row, `${label}.${field}[${index}]`, issues, notAfter);
      if (validEvidence) {
        try {
          const digest = canonicalJsonSha256(row);
          if (seen.has(digest)) issues.push(`${label}.${field} contains duplicate evidence rows`);
          seen.add(digest);
        } catch {
          issues.push(`${label}.${field}[${index}] exceeds the supported canonical JSON depth`);
        }
      }
    }
  }
}

function validateFirmwareScope(scope, label, issues) {
  if (!exactKeys(scope, FIRMWARE_KEYS, label, issues)) return;
  if (!new Set(["not_established", "observed_only"]).has(scope.status)) {
    issues.push(`${label}.status is unsupported`);
  }
  if (!Array.isArray(scope.observed_versions) || scope.observed_versions.length > 20) {
    issues.push(`${label}.observed_versions must be an array of at most 20 values`);
    return;
  }
  if (scope.status === "not_established" && scope.observed_versions.length !== 0) {
    issues.push(`${label}.not_established cannot carry versions`);
  }
  if (scope.status === "observed_only" && scope.observed_versions.length === 0) {
    issues.push(`${label}.observed_only requires at least one observed version`);
  }
  const unique = new Set();
  for (const version of scope.observed_versions) {
    if (!safeLabel(version)) issues.push(`${label} contains an unsafe observed version`);
    if (unique.has(version)) issues.push(`${label} contains duplicate observed versions`);
    unique.add(version);
  }
  const sorted = [...scope.observed_versions].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(scope.observed_versions)) {
    issues.push(`${label}.observed_versions must be sorted`);
  }
}

function validateClaim(claim, label, issues) {
  if (!exactKeys(claim, CLAIM_KEYS, label, issues)) return;
  if (!safeOid(claim.sys_object_id)) issues.push(`${label}.sys_object_id must be a non-root enterprise OID`);
  const pen = Number(String(claim.sys_object_id).split(".")[6]);
  if (!Number.isSafeInteger(claim.enterprise_number) || claim.enterprise_number < 1 || claim.enterprise_number !== pen) {
    issues.push(`${label}.enterprise_number must match the sysObjectID PEN arc`);
  }
  if (!MATCH_METHODS.has(claim.match_method)) issues.push(`${label}.match_method is unsupported`);
  if (!CLAIM_STRENGTHS.has(claim.claim_strength)) issues.push(`${label}.claim_strength is unsupported`);
  validateFirmwareScope(claim.firmware_scope, `${label}.firmware_scope`, issues);

  for (const key of ["model", "product_family", "platform"]) {
    if (claim[key] !== null && !safeLabel(claim[key])) issues.push(`${label}.${key} is unsafe or unbounded`);
  }
  if (claim.mib_identifier !== null && !safeLabel(claim.mib_identifier, MIB_IDENTIFIER)) {
    issues.push(`${label}.mib_identifier is unsafe or invalid`);
  }

  if (claim.match_method === "prefix" && (
    claim.claim_strength !== "platform"
    || claim.platform === null
    || claim.model !== null
    || claim.product_family !== null
    || claim.mib_identifier !== null
  )) {
    issues.push(`${label} prefix claims must be platform-only`);
  }
  if (claim.claim_strength === "exact_model" && (claim.match_method !== "exact" || claim.model === null || claim.mib_identifier !== null)) {
    issues.push(`${label} exact_model requires an exact match and a model`);
  }
  if (claim.claim_strength === "product_family" && (
    claim.match_method !== "exact"
    || claim.product_family === null
    || claim.model !== null
    || claim.mib_identifier !== null
    || claim.platform !== null
  )) {
    issues.push(`${label} product_family requires only an exact family claim`);
  }
  if (claim.claim_strength === "vendor_identifier" && (
    claim.match_method !== "exact"
    || claim.mib_identifier === null
    || claim.model !== null
    || claim.product_family !== null
    || claim.platform !== null
  )) {
    issues.push(`${label} vendor_identifier requires only an exact MIB identifier`);
  }
  if (claim.claim_strength === "platform" && (
    claim.platform === null
    || claim.model !== null
    || claim.product_family !== null
    || claim.mib_identifier !== null
  )) {
    issues.push(`${label} platform claims must not assert model, family, or MIB identifier`);
  }
}

function validateSanitizedObservation(observation, claim, label, issues) {
  if (!exactKeys(observation, OBSERVATION_KEYS, label, issues)) return;
  if (!safeOid(observation.sys_object_id) || observation.sys_object_id !== claim?.sys_object_id) {
    issues.push(`${label}.sys_object_id must equal the claim sysObjectID`);
  }
  if (observation.ent_physical_vendor_type !== null && !safeOid(observation.ent_physical_vendor_type)) {
    issues.push(`${label}.ent_physical_vendor_type must be null or a canonical enterprise OID`);
  }
  for (const key of ["ent_physical_model_name", "firmware_version"]) {
    if (observation[key] !== null && !safeLabel(observation[key])) issues.push(`${label}.${key} is unsafe or unbounded`);
  }
  if (!validDate(observation.observed_at)) issues.push(`${label}.observed_at must be a real YYYY-MM-DD date`);
  if (exactKeys(observation.sanitization, SANITIZATION_KEYS, `${label}.sanitization`, issues)) {
    for (const key of SANITIZATION_KEYS) {
      if (observation.sanitization[key] !== false) issues.push(`${label}.sanitization.${key} must be false`);
    }
  }
}

function validateEventIdTimestamp(identifier, occurredAt, pattern, label, issues) {
  const match = pattern.exec(identifier ?? "");
  if (!match) {
    issues.push(`${label} has an invalid identifier`);
    return;
  }
  if (validUtcSeconds(occurredAt) && match[1] !== compactTimestamp(occurredAt)) {
    issues.push(`${label} identifier timestamp does not match occurred_at`);
  }
}

function validateEventsDocument(document, issues) {
  const eventById = new Map();
  const eventDigestById = new Map();
  const mappingTips = new Map();
  const provenanceFieldsByEvent = new Map();
  if (!exactKeys(document, EVENT_DOCUMENT_KEYS, "events", issues)) {
    return { eventById, eventDigestById, mappingTips, provenanceFieldsByEvent };
  }
  if (document.schema_version !== 1) issues.push("events.schema_version must be 1");
  validatePolicy(document.policy, issues);
  if (!Array.isArray(document.events) || document.events.length > MAX_CONTRIBUTION_EVENTS) {
    issues.push(`events.events must be an array of at most ${MAX_CONTRIBUTION_EVENTS} entries`);
    return { eventById, eventDigestById, mappingTips, provenanceFieldsByEvent };
  }

  let previousTime = -Infinity;
  for (const [index, event] of document.events.entries()) {
    const label = `events.events[${index}]`;
    if (!exactKeys(event, EVENT_KEYS, label, issues)) continue;
    const eventIssueCount = issues.length;
    if (event.schema_version !== 1) issues.push(`${label}.schema_version must be 1`);
    if (!new Set(["propose", "correct", "withdraw"]).has(event.event_type)) issues.push(`${label}.event_type is unsupported`);
    if (!validUtcSeconds(event.occurred_at)) issues.push(`${label}.occurred_at must use canonical UTC seconds`);
    validateEventIdTimestamp(event.event_id, event.occurred_at, EVENT_ID, `${label}.event_id`, issues);
    if (!MAPPING_ID.test(event.mapping_id ?? "")) issues.push(`${label}.mapping_id is invalid`);
    if (!EVENT_REASONS[event.event_type]?.has(event.reason)) {
      issues.push(`${label}.reason is not allowed for ${event.event_type ?? "unknown"}`);
    }
    validateAuthority(event.authority, `${label}.authority`, issues);

    const occurred = Date.parse(event.occurred_at);
    const eventDate = validUtcSeconds(event.occurred_at) ? event.occurred_at.slice(0, 10) : null;
    if (Number.isFinite(occurred) && occurred < previousTime) issues.push(`${label} is out of chronological order`);
    if (Number.isFinite(occurred)) previousTime = occurred;
    if (eventById.has(event.event_id)) issues.push(`${label}.event_id is duplicated`);

    const currentTip = mappingTips.get(event.mapping_id);
    if (event.event_type === "propose") {
      if (event.supersedes_event_id !== null) issues.push(`${label}.propose cannot supersede another event`);
      if (currentTip) issues.push(`${label}.propose cannot reuse an existing mapping_id`);
    } else {
      if (typeof event.supersedes_event_id !== "string" || !EVENT_ID.test(event.supersedes_event_id)) {
        issues.push(`${label}.${event.event_type} requires a valid supersedes_event_id`);
      } else if (!currentTip || currentTip.event_id !== event.supersedes_event_id) {
        issues.push(`${label}.${event.event_type} must supersede the current mapping tip`);
      } else if (currentTip.event_type === "withdraw") {
        issues.push(`${label} cannot change an already withdrawn mapping`);
      }
    }

    if (event.event_type === "withdraw") {
      if (event.claim !== null) issues.push(`${label}.withdraw must not carry a claim`);
      if (!plainObject(event.field_provenance) || Object.keys(event.field_provenance).length !== 0) {
        issues.push(`${label}.withdraw field_provenance must be empty`);
      }
      if (event.sanitized_observation !== null) issues.push(`${label}.withdraw must not carry an observation`);
      if (!plainObject(event.observation_provenance) || Object.keys(event.observation_provenance).length !== 0) {
        issues.push(`${label}.withdraw observation_provenance must be empty`);
      }
      provenanceFieldsByEvent.set(event.event_id, []);
    } else {
      validateClaim(event.claim, `${label}.claim`, issues);
      const claimFields = expectedClaimProvenanceFields(event.claim);
      provenanceFieldsByEvent.set(event.event_id, claimFields);
      validateProvenanceMap(event.field_provenance, claimFields, `${label}.field_provenance`, issues, eventDate);
      if (event.sanitized_observation === null) {
        if (!plainObject(event.observation_provenance) || Object.keys(event.observation_provenance).length !== 0) {
          issues.push(`${label}.observation_provenance must be empty without an observation`);
        }
      } else {
        validateSanitizedObservation(event.sanitized_observation, event.claim, `${label}.sanitized_observation`, issues);
        if (eventDate && validDate(event.sanitized_observation?.observed_at)
          && event.sanitized_observation.observed_at > eventDate) {
          issues.push(`${label}.sanitized_observation.observed_at cannot postdate the contribution event`);
        }
        validateProvenanceMap(
          event.observation_provenance,
          expectedObservationProvenanceFields(event.sanitized_observation),
          `${label}.observation_provenance`,
          issues,
          eventDate
        );
      }
    }

    eventById.set(event.event_id, event);
    if (issues.length === eventIssueCount) {
      try {
        eventDigestById.set(event.event_id, canonicalJsonSha256(event));
      } catch {
        issues.push(`${label} exceeds the supported canonical JSON depth`);
      }
    }
    mappingTips.set(event.mapping_id, event);
  }
  return { eventById, eventDigestById, mappingTips, provenanceFieldsByEvent };
}

function validateReviewsDocument(document, eventState, issues) {
  const reviewById = new Map();
  const reviewsByEvent = new Map();
  if (!exactKeys(document, REVIEW_DOCUMENT_KEYS, "reviews", issues)) return { reviewById, reviewsByEvent };
  if (document.schema_version !== 1) issues.push("reviews.schema_version must be 1");
  if (!Array.isArray(document.reviews) || document.reviews.length > MAX_CONTRIBUTION_REVIEWS) {
    issues.push(`reviews.reviews must be an array of at most ${MAX_CONTRIBUTION_REVIEWS} entries`);
    return { reviewById, reviewsByEvent };
  }

  let previousTime = -Infinity;
  for (const [index, review] of document.reviews.entries()) {
    const label = `reviews.reviews[${index}]`;
    if (!exactKeys(review, REVIEW_KEYS, label, issues)) continue;
    if (review.schema_version !== 1) issues.push(`${label}.schema_version must be 1`);
    if (!validUtcSeconds(review.occurred_at)) issues.push(`${label}.occurred_at must use canonical UTC seconds`);
    validateEventIdTimestamp(review.review_id, review.occurred_at, REVIEW_ID, `${label}.review_id`, issues);
    if (reviewById.has(review.review_id)) issues.push(`${label}.review_id is duplicated`);
    if (!REVIEW_DECISIONS.has(review.decision)) issues.push(`${label}.decision is unsupported`);
    if (!MAPPING_ID.test(review.mapping_id ?? "")) issues.push(`${label}.mapping_id is invalid`);
    if (!SHA256.test(review.contribution_event_sha256 ?? "")) issues.push(`${label}.contribution_event_sha256 is invalid`);
    if (!REVIEW_REASONS[review.decision]?.has(review.reason)) {
      issues.push(`${label}.reason is not allowed for ${review.decision ?? "unknown"}`);
    }
    if (review.publication_state !== "quarantine") issues.push(`${label}.publication_state must remain quarantine`);
    if (review.promotion_required !== true) issues.push(`${label}.promotion_required must be true`);

    const occurred = Date.parse(review.occurred_at);
    if (Number.isFinite(occurred) && occurred < previousTime) issues.push(`${label} is out of chronological order`);
    if (Number.isFinite(occurred)) previousTime = occurred;

    const event = eventState.eventById.get(review.contribution_event_id);
    if (!event) {
      issues.push(`${label}.contribution_event_id does not exist`);
    } else {
      if (review.mapping_id !== event.mapping_id) issues.push(`${label}.mapping_id does not match the contribution event`);
      if (review.contribution_event_sha256 !== eventState.eventDigestById.get(event.event_id)) {
        issues.push(`${label}.contribution_event_sha256 does not bind the exact event`);
      }
      if (Date.parse(review.occurred_at) < Date.parse(event.occurred_at)) issues.push(`${label} predates its contribution event`);
    }

    const reviewedFields = Array.isArray(review.reviewed_fields) ? review.reviewed_fields : [];
    if (!Array.isArray(review.reviewed_fields)
      || reviewedFields.some((field) => typeof field !== "string")
      || new Set(reviewedFields).size !== reviewedFields.length
      || JSON.stringify([...reviewedFields].sort()) !== JSON.stringify(reviewedFields)) {
      issues.push(`${label}.reviewed_fields must be a sorted unique string array`);
    }
    const expectedFields = eventState.provenanceFieldsByEvent.get(review.contribution_event_id) ?? [];
    if (review.decision === "approved-evidence") {
      if (!event || event.event_type === "withdraw") issues.push(`${label}.approved-evidence requires a claim event`);
      if (!REVIEW_SCOPES.has(review.approved_publication_scope)) issues.push(`${label}.approved_publication_scope is invalid`);
      if (JSON.stringify(reviewedFields) !== JSON.stringify(expectedFields)) {
        issues.push(`${label}.approved-evidence must review every normalized claim field`);
      }
      const permittedEvidenceScopes = REVIEW_SCOPE_EVIDENCE[review.approved_publication_scope];
      if (event && permittedEvidenceScopes) {
        for (const field of expectedFields) {
          const rows = event.field_provenance?.[field];
          if (!Array.isArray(rows) || !rows.some((row) => permittedEvidenceScopes.has(row?.publication_scope))) {
            issues.push(`${label}.approved_publication_scope has no compatible evidence for ${field}`);
          }
        }
      }
    } else {
      if (review.approved_publication_scope !== null) issues.push(`${label} non-approval decisions cannot grant a publication scope`);
      if (reviewedFields.length !== 0) issues.push(`${label} non-approval decisions must use an empty reviewed_fields array`);
    }
    if (review.decision === "withdrawal-acknowledged" && event?.event_type !== "withdraw") {
      issues.push(`${label}.withdrawal-acknowledged requires a withdrawal event`);
    }
    if (event?.event_type === "withdraw" && review.decision !== "withdrawal-acknowledged") {
      issues.push(`${label} withdrawal events require withdrawal-acknowledged`);
    }

    if (exactKeys(review.reviewer_attestation, REVIEWER_KEYS, `${label}.reviewer_attestation`, issues)) {
      if (review.reviewer_attestation.role !== "repository-maintainer") {
        issues.push(`${label}.reviewer_attestation.role must be repository-maintainer`);
      }
      for (const key of ["evidence_reviewed", "rights_scope_reviewed", "sensitive_data_reviewed"]) {
        if (review.reviewer_attestation[key] !== true) issues.push(`${label}.reviewer_attestation.${key} must be true`);
      }
    }

    reviewById.set(review.review_id, review);
    if (!reviewsByEvent.has(review.contribution_event_id)) reviewsByEvent.set(review.contribution_event_id, []);
    reviewsByEvent.get(review.contribution_event_id).push(review);
  }
  return { reviewById, reviewsByEvent };
}

export function validateDeviceIdentityContributionLedgers(eventsDocument, reviewsDocument) {
  const issues = [];
  const eventState = validateEventsDocument(eventsDocument, issues);
  const reviewState = validateReviewsDocument(reviewsDocument, eventState, issues);
  return Object.freeze({ issues, ...eventState, ...reviewState });
}

function identityLabel(claim) {
  return claim.model ?? claim.product_family ?? claim.mib_identifier ?? claim.platform ?? claim.claim_strength;
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function makeReport(eventsDocument, reviewsDocument, state) {
  const latestReviewByEvent = new Map();
  for (const [eventId, reviews] of state.reviewsByEvent) latestReviewByEvent.set(eventId, reviews.at(-1));

  const activeTips = [...state.mappingTips.values()]
    .filter((event) => event.event_type !== "withdraw")
    .sort((left, right) => compareCodePoints(left.mapping_id, right.mapping_id));
  const matchGroups = new Map();
  for (const event of activeTips) {
    const key = `${event.claim.match_method}:${event.claim.sys_object_id}`;
    if (!matchGroups.has(key)) matchGroups.set(key, []);
    matchGroups.get(key).push(event);
  }

  const duplicateClaimGroups = [];
  const conflictGroups = [];
  for (const [matchKey, events] of [...matchGroups].sort(([left], [right]) => compareCodePoints(left, right))) {
    if (events.length < 2) continue;
    const claimDigests = [...new Set(events.map((event) => canonicalJsonSha256(event.claim)))].sort();
    const row = {
      match_key: matchKey,
      event_ids: events.map((event) => event.event_id).sort(),
      mapping_ids: events.map((event) => event.mapping_id).sort(),
      claim_sha256s: claimDigests
    };
    if (claimDigests.length === 1) duplicateClaimGroups.push(row);
    else conflictGroups.push(row);
  }

  const allEvents = eventsDocument.events;
  const pending = allEvents
    .filter((event) => !latestReviewByEvent.has(event.event_id))
    .map((event) => event.event_id)
    .sort();
  const approved = allEvents
    .filter((event) => latestReviewByEvent.get(event.event_id)?.decision === "approved-evidence")
    .map((event) => event.event_id)
    .sort();
  const decisions = Object.fromEntries([...REVIEW_DECISIONS].sort().map((decision) => [
    decision,
    reviewsDocument.reviews.filter((review) => review.decision === decision).length
  ]));
  const report = {
    schema_version: 1,
    publication_boundary: {
      contribution_state: "quarantine",
      automatic_publication_count: 0,
      separate_release_promotion_required: true
    },
    source_digests: {
      events_sha256: canonicalJsonSha256(eventsDocument),
      reviews_sha256: canonicalJsonSha256(reviewsDocument)
    },
    counts: {
      events: allEvents.length,
      proposals: allEvents.filter((event) => event.event_type === "propose").length,
      corrections: allEvents.filter((event) => event.event_type === "correct").length,
      withdrawals: allEvents.filter((event) => event.event_type === "withdraw").length,
      reviews: reviewsDocument.reviews.length,
      active_mapping_tips: activeTips.length,
      pending_review_events: pending.length,
      approved_evidence_events: approved.length,
      duplicate_claim_groups: duplicateClaimGroups.length,
      conflict_groups: conflictGroups.length
    },
    review_decisions: decisions,
    pending_review_event_ids: pending,
    approved_evidence_event_ids: approved,
    duplicate_claim_groups: duplicateClaimGroups,
    conflict_groups: conflictGroups,
    mapping_tips: [...state.mappingTips.values()]
      .sort((left, right) => compareCodePoints(left.mapping_id, right.mapping_id))
      .map((event) => ({
        mapping_id: event.mapping_id,
        event_id: event.event_id,
        event_type: event.event_type,
        match_key: event.claim ? `${event.claim.match_method}:${event.claim.sys_object_id}` : null,
        claim_strength: event.claim?.claim_strength ?? null,
        claim_label: event.claim ? identityLabel(event.claim) : null,
        latest_review_decision: latestReviewByEvent.get(event.event_id)?.decision ?? null
      })),
    report_sha256: null
  };
  report.report_sha256 = canonicalJsonSha256(Object.fromEntries(
    Object.entries(report).filter(([key]) => key !== "report_sha256")
  ));
  return report;
}

export function buildDeviceIdentityContributionReport(eventsDocument, reviewsDocument) {
  const state = validateDeviceIdentityContributionLedgers(eventsDocument, reviewsDocument);
  if (state.issues.length) throw new DeviceIdentityContributionError(state.issues);
  return makeReport(eventsDocument, reviewsDocument, state);
}

export function validateDeviceIdentityContributionBundle({ events, reviews, report }) {
  const state = validateDeviceIdentityContributionLedgers(events, reviews);
  const issues = [...state.issues];
  let expectedReport = null;
  if (!issues.length) {
    expectedReport = makeReport(events, reviews, state);
    let reportMatches = false;
    try {
      reportMatches = canonicalJsonSha256(report) === canonicalJsonSha256(expectedReport);
    } catch {
      issues.push("review report must be a canonicalizable JSON value");
    }
    if (!reportMatches && !issues.includes("review report must be a canonicalizable JSON value")) {
      issues.push("review report does not match the deterministic ledger projection");
    }
  }
  if (issues.length) throw new DeviceIdentityContributionError(issues);
  return Object.freeze({
    events: events.events.length,
    reviews: reviews.reviews.length,
    pending: expectedReport.counts.pending_review_events,
    conflicts: expectedReport.counts.conflict_groups,
    automatic_publication: expectedReport.publication_boundary.automatic_publication_count
  });
}

function assertPrefix(before, after, label, issues) {
  if (after.length < before.length) {
    issues.push(`${label} entries cannot be removed`);
    return;
  }
  for (let index = 0; index < before.length; index += 1) {
    let matches = false;
    try {
      matches = canonicalJsonSha256(before[index]) === canonicalJsonSha256(after[index]);
    } catch {
      issues.push(`${label}[${index}] exceeds the supported canonical JSON depth`);
      continue;
    }
    if (!matches) {
      issues.push(`${label}[${index}] cannot be modified or reordered`);
    }
  }
}

export function validateDeviceIdentityContributionAppendOnlyTransition({
  beforeEvents,
  afterEvents,
  beforeReviews,
  afterReviews,
  actor,
  repositoryOwner
}) {
  const beforeState = validateDeviceIdentityContributionLedgers(beforeEvents, beforeReviews);
  const afterState = validateDeviceIdentityContributionLedgers(afterEvents, afterReviews);
  const issues = [
    ...beforeState.issues.map((issue) => `base: ${issue}`),
    ...afterState.issues.map((issue) => `head: ${issue}`)
  ];
  if (plainObject(beforeEvents?.policy) && plainObject(afterEvents?.policy)) {
    try {
      if (canonicalJsonSha256(beforeEvents.policy) !== canonicalJsonSha256(afterEvents.policy)) {
        issues.push("contribution policy cannot change inside a ledger append");
      }
    } catch {
      issues.push("contribution policy exceeds the supported canonical JSON depth");
    }
  }
  const beforeEventRows = Array.isArray(beforeEvents?.events) ? beforeEvents.events : [];
  const afterEventRows = Array.isArray(afterEvents?.events) ? afterEvents.events : [];
  const beforeReviewRows = Array.isArray(beforeReviews?.reviews) ? beforeReviews.reviews : [];
  const afterReviewRows = Array.isArray(afterReviews?.reviews) ? afterReviews.reviews : [];
  assertPrefix(beforeEventRows, afterEventRows, "contribution events", issues);
  assertPrefix(beforeReviewRows, afterReviewRows, "contribution reviews", issues);
  const appendedReviews = Math.max(0, afterReviewRows.length - beforeReviewRows.length);
  if (appendedReviews > 0 && (
    typeof actor !== "string"
    || typeof repositoryOwner !== "string"
    || actor.toLowerCase() !== repositoryOwner.toLowerCase()
  )) {
    issues.push("only the repository owner may append maintainer review events");
  }
  if (issues.length) throw new DeviceIdentityContributionError(issues);
  return Object.freeze({
    appended_events: afterEventRows.length - beforeEventRows.length,
    appended_reviews: appendedReviews
  });
}

export function emptyContributionEventsDocument() {
  return { schema_version: 1, policy: { ...CONTRIBUTION_POLICY }, events: [] };
}

export function emptyContributionReviewsDocument() {
  return { schema_version: 1, reviews: [] };
}
