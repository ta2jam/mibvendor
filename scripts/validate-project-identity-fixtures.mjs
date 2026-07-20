import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256 } from "./canonical-json.mjs";

const ENTERPRISE_OID = /^\.1\.3\.6\.1\.4\.1\.(\d+)(?:\.\d+)*$/;
const FORBIDDEN_NORMALIZED_KEYS = new Set([
  "authorization",
  "community",
  "entphysicalserialnum",
  "firmwarerange",
  "ifalias",
  "location",
  "macaddress",
  "rawfixture",
  "rawwalk",
  "serial",
  "syscontact",
  "sysdescr",
  "sysname",
]);
const CANDIDATE_KEYS = new Set([
  "candidate_id",
  "claim_scope",
  "claim_strength",
  "confidence",
  "device_class",
  "family",
  "match_method",
  "model",
  "observations",
  "platform",
  "source_id",
  "usable_for",
  "vendor_label",
]);
const IDENTITY_KEYS = new Set([
  "candidate_count",
  "candidates",
  "confidence",
  "enterprise_number",
  "enterprise_organization_name",
  "evidence_state",
  "organization_key",
  "sys_object_id",
]);
const EVIDENCE_KEYS = new Set([
  "ent_physical_model_match_count",
  "git_blob_oid",
  "json_pointers",
  "line_evidence",
  "source_path",
  "source_sha256",
]);

function normalizedKey(key) {
  return key.replace(/[-_]/g, "").toLowerCase();
}

function unsafeModel(model) {
  return typeof model !== "string"
    || !model.trim()
    || model.length > 80
    || /<private>/i.test(model)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(model)
    || /@|(?:https?|ftp):\/\/|\bwww\./i.test(model)
    || /\b(?:serial(?:\s+number)?|s\/n)\s*[:=#]\s*\S+/i.test(model)
    || /\bSN\s*:\s*\S+/i.test(model)
    || /\b(?:host(?:name)?|contact|location)\s*[:=#]\s*\S+/i.test(model)
    || /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(model)
    || /\b[0-9a-f]{2}(?:(?::|-)[0-9a-f]{2}){5}\b/i.test(model)
    || /\b[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}\b/i.test(model)
    || /\b[0-9a-f]{12}\b/i.test(model)
    || /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(model)
    || /\bCPU\b|\brunning at\b|\bLinux\s+\d+\.\d+.*#\d+/i.test(model);
}

function walkKeys(value, failures, location = "document") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, failures, `${location}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_NORMALIZED_KEYS.has(normalizedKey(key))) failures.push(`${location} contains prohibited field ${key}`);
    walkKeys(child, failures, `${location}.${key}`);
  }
}

function compareOid(left, right) {
  const leftParts = left.replace(/^\./, "").split(".").map(Number);
  const rightParts = right.replace(/^\./, "").split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function documentDigest(document) {
  const { document_sha256: _omitted, ...projection } = document;
  return canonicalJsonSha256(projection);
}

function countEvidenceBySource(document) {
  const counts = new Map();
  const files = new Map();
  for (const identity of document.identities ?? []) {
    for (const candidate of identity.candidates ?? []) {
      counts.set(candidate.source_id, (counts.get(candidate.source_id) ?? 0) + (candidate.observations?.length ?? 0));
      const sourceFiles = files.get(candidate.source_id) ?? new Set();
      for (const evidence of candidate.observations ?? []) sourceFiles.add(evidence.source_path);
      files.set(candidate.source_id, sourceFiles);
    }
  }
  return { counts, files };
}

export function validateProjectFixtureDocument(manifest, document, iana) {
  const failures = [];
  if (manifest.schema_version !== 1 || document.schema_version !== 1) failures.push("Project fixture schema version must be 1");
  if (document.dataset_id !== manifest.dataset_id) failures.push("Dataset id drift");
  if (document.generated_at !== null) failures.push("Deterministic project fixture output must not contain a generation timestamp");
  if (!sameJson(document.policy, manifest.policy)) failures.push("Project fixture policy drift");
  if (document.document_sha256 !== documentDigest(document)) failures.push("Project fixture document digest drift");
  if (!sameJson(document.enterprise_registry_snapshot, manifest.enterprise_registry_snapshot)) failures.push("PEN registry snapshot drift");

  const expectedOrganizationSnapshot = {
    repository: manifest.organization_mapping_snapshot.repository,
    revision: manifest.organization_mapping_snapshot.revision,
    path: manifest.organization_mapping_snapshot.path,
    git_blob_oid: manifest.organization_mapping_snapshot.git_blob_oid,
    sha256: manifest.organization_mapping_snapshot.sha256,
    reviewed_pen_links: manifest.organization_mapping_snapshot.reviewed_pen_links.length,
  };
  if (!sameJson(document.organization_mapping_snapshot, expectedOrganizationSnapshot)) failures.push("Organization mapping snapshot drift");

  const sourceConfigs = new Map(manifest.sources.map((source) => [source.id, source]));
  const sourceSummaries = new Map((document.sources ?? []).map((source) => [source.id, source]));
  if (sourceConfigs.size !== manifest.sources.length || sourceSummaries.size !== (document.sources ?? []).length) failures.push("Source ids must be unique");
  if (!sameJson([...sourceConfigs.keys()].sort(), [...sourceSummaries.keys()].sort())) failures.push("Project fixture source set drift");
  for (const [sourceId, config] of sourceConfigs) {
    const source = sourceSummaries.get(sourceId);
    if (!source) continue;
    if (source.repository !== config.repository || source.revision !== config.revision || source.parser !== config.parser) {
      failures.push(`Source provenance drift ${sourceId}`);
    }
    if (source.input_file_count !== config.expected_input_files) failures.push(`Source input count drift ${sourceId}`);
    if (source.license?.classifier !== "manual-pinned-content-v1") failures.push(`Source license classifier drift ${sourceId}`);
    if (source.license?.status !== "approved" || source.license?.spdx !== config.license_classifier.expected_spdx) {
      failures.push(`Source is not approved by pinned license classifier ${sourceId}`);
    }
    if (!Array.isArray(source.license?.failures) || source.license.failures.length !== 0) failures.push(`Source license failures are not empty ${sourceId}`);
    const expectedEvidence = config.license_classifier.files
      .map((file) => ({ path: file.path, git_blob_oid: file.git_blob_oid, sha256: file.sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (!sameJson(source.license?.evidence, expectedEvidence)) failures.push(`Source license evidence drift ${sourceId}`);
  }

  const penNames = new Map(iana.records);
  const organizationKeys = new Map(manifest.organization_mapping_snapshot.reviewed_pen_links
    .map((link) => [link.enterprise_number, link.organization_key]));
  const sourceEvidence = countEvidenceBySource(document);
  const candidateIds = new Set();
  const identityOids = new Set();
  let previousOid = null;
  for (const identity of document.identities ?? []) {
    for (const key of Object.keys(identity)) if (!IDENTITY_KEYS.has(key)) failures.push(`Unexpected identity field ${key}`);
    const oidMatch = identity.sys_object_id?.match(ENTERPRISE_OID);
    if (!oidMatch) failures.push(`Identity is not an exact enterprise OID: ${identity.sys_object_id}`);
    const enterpriseNumber = oidMatch ? Number(oidMatch[1]) : null;
    if (identity.enterprise_number !== enterpriseNumber) failures.push(`Enterprise number drift ${identity.sys_object_id}`);
    if (identity.enterprise_organization_name !== (penNames.get(enterpriseNumber) ?? null)) failures.push(`PEN organization drift ${identity.sys_object_id}`);
    if (identity.organization_key !== (organizationKeys.get(enterpriseNumber) ?? null)) failures.push(`Organization key is not an exact reviewed PEN link ${identity.sys_object_id}`);
    if (identityOids.has(identity.sys_object_id)) failures.push(`Duplicate identity OID ${identity.sys_object_id}`);
    identityOids.add(identity.sys_object_id);
    if (previousOid && compareOid(previousOid, identity.sys_object_id) >= 0) failures.push(`Identity OIDs are not numerically sorted at ${identity.sys_object_id}`);
    previousOid = identity.sys_object_id;
    if (!Array.isArray(identity.candidates) || identity.candidates.length === 0) failures.push(`Identity has no candidates ${identity.sys_object_id}`);
    if (identity.candidate_count !== identity.candidates?.length) failures.push(`Candidate count drift ${identity.sys_object_id}`);
    const modelCount = new Set((identity.candidates ?? []).map((candidate) => candidate.model.toLowerCase())).size;
    const expectedState = modelCount > 1 ? "conflicting_observations" : "single_observation";
    if (identity.evidence_state !== expectedState) failures.push(`Conflict state drift ${identity.sys_object_id}`);
    if (identity.confidence !== (modelCount > 1 ? "low" : identity.candidates?.some((candidate) => candidate.confidence === "high") ? "high" : "medium")) {
      failures.push(`Identity confidence drift ${identity.sys_object_id}`);
    }

    for (const candidate of identity.candidates ?? []) {
      for (const key of Object.keys(candidate)) if (!CANDIDATE_KEYS.has(key)) failures.push(`Unexpected candidate field ${key}`);
      if (candidateIds.has(candidate.candidate_id)) failures.push(`Duplicate candidate id ${candidate.candidate_id}`);
      candidateIds.add(candidate.candidate_id);
      if (!/^fixture_[0-9a-f]{20}$/.test(candidate.candidate_id)) failures.push(`Invalid candidate id ${candidate.candidate_id}`);
      if (!sourceConfigs.has(candidate.source_id)) failures.push(`Unknown candidate source ${candidate.source_id}`);
      if (candidate.match_method !== "exact-sys-object-id-observation") failures.push(`Candidate match method can only be exact observation ${candidate.candidate_id}`);
      if (candidate.claim_scope !== "observation-only" || candidate.usable_for !== "corroboration") failures.push(`Candidate overstates its claim ${candidate.candidate_id}`);
      if (!new Set(["single-fixture-observation", "entity-corroborated-fixture-observation", "literal-project-test-observation"]).has(candidate.claim_strength)) {
        failures.push(`Invalid claim strength ${candidate.candidate_id}`);
      }
      if (!new Set(["medium", "high"]).has(candidate.confidence)) failures.push(`Invalid candidate confidence ${candidate.candidate_id}`);
      if (unsafeModel(candidate.model)) {
        failures.push(`Unsafe candidate model ${candidate.candidate_id}`);
      }
      if (candidate.family !== null) failures.push(`Unproven family claim ${candidate.candidate_id}`);
      if (!Array.isArray(candidate.observations) || candidate.observations.length === 0) failures.push(`Candidate has no observations ${candidate.candidate_id}`);
      for (const evidence of candidate.observations ?? []) {
        for (const key of Object.keys(evidence)) if (!EVIDENCE_KEYS.has(key)) failures.push(`Unexpected evidence field ${key}`);
        if (!evidence.source_path || path.isAbsolute(evidence.source_path) || evidence.source_path.split("/").includes("..")) failures.push(`Unsafe evidence path ${candidate.candidate_id}`);
        if (!/^[0-9a-f]{40}$/.test(evidence.git_blob_oid)) failures.push(`Invalid evidence Git blob ${candidate.candidate_id}`);
        if (!/^[0-9a-f]{64}$/.test(evidence.source_sha256)) failures.push(`Invalid evidence SHA-256 ${candidate.candidate_id}`);
        if (!Number.isSafeInteger(evidence.ent_physical_model_match_count) || evidence.ent_physical_model_match_count < 0) failures.push(`Invalid ENTITY corroboration count ${candidate.candidate_id}`);
        if (candidate.source_id === "librenms-project-tests") {
          if (evidence.line_evidence.length !== 0 || evidence.json_pointers.length < 2) failures.push(`LibreNMS evidence selectors drift ${candidate.candidate_id}`);
          for (const pointer of evidence.json_pointers) {
            if (!/^\/os\/discovery\/devices\/\d+\/(?:sysObjectID|hardware|os|type)$/.test(pointer)
              && !/^\/entity-physical\/discovery\/entPhysical\/\d+\/entPhysicalModelName$/.test(pointer)) {
              failures.push(`LibreNMS evidence pointer is outside the allowlist ${pointer}`);
            }
          }
        } else if (candidate.source_id === "snmp-info-project-tests") {
          if (evidence.json_pointers.length !== 0 || evidence.line_evidence.length < 2) failures.push(`SNMP::Info evidence selectors drift ${candidate.candidate_id}`);
          for (const line of evidence.line_evidence) {
            if (!Number.isSafeInteger(line.line) || line.line < 1 || !new Set(["sys_object_id", "model", "vendor_label"]).has(line.field)) {
              failures.push(`Invalid SNMP::Info line evidence ${candidate.candidate_id}`);
            }
          }
        }
      }
    }
  }

  const allCandidates = (document.identities ?? []).flatMap((identity) => identity.candidates ?? []);
  const allEvidence = allCandidates.flatMap((candidate) => candidate.observations.map((evidence) => ({ source_id: candidate.source_id, evidence })));
  const expectedCounts = {
    input_files: (document.sources ?? []).reduce((sum, source) => sum + source.input_file_count, 0),
    files_with_observations: new Set(allEvidence.map(({ source_id, evidence }) => `${source_id}:${evidence.source_path}`)).size,
    observations: allEvidence.length,
    exact_oids: document.identities?.length ?? 0,
    identity_candidates: allCandidates.length,
    conflicting_exact_oids: (document.identities ?? []).filter((identity) => identity.evidence_state === "conflicting_observations").length,
    corroborated_observations: allEvidence.filter(({ evidence }) => evidence.ent_physical_model_match_count > 0).length,
    identities_with_reviewed_organization_key: (document.identities ?? []).filter((identity) => identity.organization_key !== null).length,
    rejected_input_records: (document.sources ?? []).reduce((sum, source) => sum + source.rejected_input_records, 0),
    by_source: Object.fromEntries((document.sources ?? []).map((source) => [source.id, {
      input_files: source.input_file_count,
      files_with_observations: sourceEvidence.files.get(source.id)?.size ?? 0,
      observations: sourceEvidence.counts.get(source.id) ?? 0,
      rejected_input_records: source.rejected_input_records,
    }]).sort(([left], [right]) => left.localeCompare(right))),
  };
  if (!sameJson(document.counts, expectedCounts)) failures.push("Measured project fixture counts drift");
  if (!sameJson(document.counts, manifest.expected_measurements)) failures.push("Reviewed project fixture measurements drift");
  for (const source of document.sources ?? []) {
    if (source.files_with_observations !== (sourceEvidence.files.get(source.id)?.size ?? 0)) failures.push(`Source observed file count drift ${source.id}`);
    if (source.observation_count !== (sourceEvidence.counts.get(source.id) ?? 0)) failures.push(`Source observation count drift ${source.id}`);
  }

  const c9300 = (document.identities ?? []).find((identity) => identity.sys_object_id === ".1.3.6.1.4.1.9.1.2494");
  const c9300Candidate = c9300?.candidates.find((candidate) => candidate.model === "C9300-48P");
  if (!c9300Candidate
    || c9300.organization_key !== "Q173395"
    || c9300Candidate.claim_scope !== "observation-only"
    || c9300Candidate.usable_for !== "corroboration"
    || !c9300Candidate.observations.some((evidence) => evidence.ent_physical_model_match_count >= 2)) {
    failures.push("C9300 observation lost exact OID, reviewed organization link, or ENTITY-MIB corroboration boundary");
  }

  walkKeys(document, failures);
  const serialized = JSON.stringify(document);
  if (/FCW2204L050|RTC1818005K|"(?:sysName|sysDescr|sysContact|location|serial)"\s*:/i.test(serialized)) {
    failures.push("Project fixture output contains a known private-field canary");
  }
  return failures;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const manifest = JSON.parse(await readFile(path.join(root, "data", "device-identities", "project-fixtures-manifest.json"), "utf8"));
  const document = JSON.parse(await readFile(path.join(root, "data", "device-identities", "project-fixtures.json"), "utf8"));
  const iana = JSON.parse(await readFile(path.join(root, "data", "iana-private-enterprise-numbers.json"), "utf8"));
  const failures = validateProjectFixtureDocument(manifest, document, iana);
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  } else {
    console.log(`Project fixture intake passed: ${document.counts.observations} observations, ${document.counts.exact_oids} exact OIDs, ${document.counts.conflicting_exact_oids} conflicts.`);
  }
}
