import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256 } from "./canonical-json.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const identityRoot = path.join(projectRoot, "data", "device-identities");
const manifestPath = path.join(identityRoot, "project-definitions-manifest.json");
const outputPath = path.join(identityRoot, "project-definitions.json");
const ENTERPRISES_PREFIX = "1.3.6.1.4.1";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobOid(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function digestWithout(document, field) {
  return canonicalJsonSha256(Object.fromEntries(Object.entries(document).filter(([key]) => key !== field)));
}

function numericOidCompare(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function decodePhpSingleQuoted(value) {
  if (/\\(?![\\'])/.test(value)) throw new Error("Unsupported PHP single-quoted escape");
  return value.replace(/\\([\\'])/g, "$1");
}

export function parseRackTablesKnownSwitches(source) {
  const text = String(source).replace(/\r\n?/g, "\n");
  const startMarker = "$known_switches = array // key is system OID w/o \"enterprises\" prefix";
  const endMarker = "global $swtype_pcre;";
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || text.indexOf(startMarker, start + 1) >= 0) {
    throw new Error("RackTables known_switches section boundary drift");
  }
  const section = text.slice(start, end);
  const entryPattern = /^\t'(\d+(?:\.\d+)*)'\s*=>\s*array(?:\s*#.*)?\s*$/gm;
  const starts = [...section.matchAll(entryPattern)];
  const allTopLevelArrays = [...section.matchAll(/^\t[^\t\r\n].*?=>\s*array(?:\s*(?:#.*)?)?\s*$/gm)];
  if (allTopLevelArrays.length !== starts.length) throw new Error("RackTables known_switches contains a non-literal top-level key");
  const entries = [];
  for (let index = 0; index < starts.length; index += 1) {
    const match = starts[index];
    const arcs = match[1].split(".").map(Number);
    if (arcs.some((arc) => !Number.isSafeInteger(arc) || arc < 0 || arc > 0xffffffff)) {
      throw new Error(`${match[1]}: numeric OID arc is outside the supported range`);
    }
    const body = section.slice(match.index, starts[index + 1]?.index ?? section.length);
    const textMatches = [...body.matchAll(/^\t\t'text'\s*=>\s*'((?:[^'\\]|\\.)*)',\s*$/gm)];
    if (textMatches.length !== 1) throw new Error(`${match[1]}: expected one static text literal`);
    const sourceLine = text.slice(0, start + match.index).split("\n").length;
    entries.push(Object.freeze({
      source_key: match[1],
      source_line: sourceLine,
      source_text: decodePhpSingleQuoted(textMatches[0][1])
    }));
  }
  if (!entries.length) throw new Error("RackTables known_switches contains no static entries");
  return entries;
}

const SENSITIVE_VALUE_PATTERNS = Object.freeze([
  /<private>/iu,
  /@|(?:https?|ftp):\/\/|\bwww\./iu,
  /\b(?:api[ _-]?key|token|private[ _-]?key|password|secret|community(?:[ _-]?string)?)\b/iu,
  /\b(?:serial(?:\s+number)?|s\/n)\s*[:=#]\s*\S+/iu,
  /\bSN\s*:\s*\S+/iu,
  /\b(?:host(?:name)?|contact|location)\s*[:=#]\s*\S+/iu,
  /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/iu,
  /\b[0-9A-F]{4}(?:\.[0-9A-F]{4}){2}\b/iu,
  /\b[0-9A-F]{12}\b/iu,
  /\b[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\b/iu,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
  /[\u0000-\u001f\u007f]/u
]);

export function normalizeRackTablesModel(sourceText) {
  const sanitized = String(sourceText).replace(/%GPASS%/g, " ").replace(/\s+/g, " ").trim();
  if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(sanitized))) return { model: null, reason: "sensitive-or-non-model-value" };
  const boundaries = [sanitized.indexOf(":"), sanitized.indexOf(",")].filter((index) => index >= 0);
  if (!boundaries.length) return { model: null, reason: "model-boundary-not-unambiguous" };
  let model = sanitized.slice(0, Math.min(...boundaries)).trim();
  const numericSwitchModel = /^(\d{4})\s+\d+-port$/iu.exec(model)?.[1] ?? null;
  model = model
    .replace(/\s+\d+-port$/iu, "")
    .replace(/\s+Switch(?:\s+with\b.*)?$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!model) return { model: null, reason: "empty-model-after-summary-strip" };
  if (model.length > 80) return { model: null, reason: "model-too-long" };
  if ((!/[A-Za-z]/u.test(model) || !/\d/u.test(model)) && model !== numericSwitchModel) {
    return { model: null, reason: "model-missing-alpha-numeric-signal" };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._+()\/-]*$/u.test(model)) return { model: null, reason: "model-contains-unsupported-character" };
  if (/\s(?:or|and)\s/iu.test(model)) return { model: null, reason: "ambiguous-multi-model-label" };
  return { model, reason: null };
}

async function readVerifiedArtifact(repositoryRoot, artifact) {
  const absolute = path.resolve(repositoryRoot, artifact.path);
  if (!absolute.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)) throw new Error(`Artifact path escaped source repository: ${artifact.path}`);
  const bytes = await readFile(absolute);
  if (bytes.length !== artifact.bytes) throw new Error(`${artifact.path}: byte count drift`);
  if (sha256(bytes) !== artifact.sha256) throw new Error(`${artifact.path}: SHA-256 drift`);
  if (gitBlobOid(bytes) !== artifact.git_blob_oid) throw new Error(`${artifact.path}: Git blob drift`);
  return bytes;
}

export async function buildProjectIdentityDefinitions(manifest, { repositoryRoot, penDocument, retainedRoot = projectRoot }) {
  if (manifest?.schema_version !== 1 || manifest?.layer !== "open-source-project-device-definitions") {
    throw new Error("Unsupported project identity definition manifest");
  }
  const repositoryCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  if (repositoryCommit !== manifest.source_repository.commit) throw new Error(`RackTables revision drift: ${repositoryCommit}`);
  const sourceBytes = await readVerifiedArtifact(repositoryRoot, manifest.source_repository.source_artifact);
  for (const artifact of manifest.source_repository.review_artifacts ?? []) await readVerifiedArtifact(repositoryRoot, artifact);
  for (const artifact of manifest.source_repository.license_signal.files) {
    const upstreamBytes = await readVerifiedArtifact(repositoryRoot, artifact);
    const retainedPath = path.resolve(retainedRoot, artifact.retained_path);
    if (!retainedPath.startsWith(`${path.resolve(retainedRoot)}${path.sep}`)) throw new Error(`Retained license path escaped project: ${artifact.retained_path}`);
    const retainedBytes = await readFile(retainedPath);
    if (!upstreamBytes.equals(retainedBytes)) throw new Error(`${artifact.path}: retained license bytes drift`);
  }
  if (canonicalJsonSha256(penDocument) !== manifest.enterprise_registry.document_canonical_sha256) {
    throw new Error("IANA PEN document drift");
  }
  const penNames = new Map(penDocument.records);
  const parsed = parseRackTablesKnownSwitches(sourceBytes.toString("utf8"));
  const quarantineOverrides = new Map((manifest.quarantine_overrides ?? []).map((record) => [record.source_key, record.reason]));
  if (quarantineOverrides.size !== (manifest.quarantine_overrides ?? []).length) throw new Error("Duplicate quarantine override key");
  const usedQuarantineOverrides = new Set();
  const definitions = [];
  const quarantine = [];
  const rejections = [];
  const seenSourceKeys = new Set();
  for (const entry of parsed) {
    if (seenSourceKeys.has(entry.source_key)) throw new Error(`Duplicate RackTables source key: ${entry.source_key}`);
    seenSourceKeys.add(entry.source_key);
    const arcs = entry.source_key.split(".").map(Number);
    const enterpriseNumber = arcs[0];
    const sysObjectId = `${ENTERPRISES_PREFIX}.${entry.source_key}`;
    const evidence = {
      source_key: entry.source_key,
      sys_object_id: sysObjectId,
      enterprise_number: enterpriseNumber,
      declaration_line: entry.source_line,
      source_text_sha256: sha256(Buffer.from(entry.source_text))
    };
    if (arcs.length === 1) {
      rejections.push({ ...evidence, reason: "enterprise-root-not-exact-device" });
      continue;
    }
    if (!penNames.has(enterpriseNumber)) throw new Error(`${entry.source_key}: PEN ${enterpriseNumber} is absent from the pinned IANA registry`);
    if (quarantineOverrides.has(entry.source_key)) {
      usedQuarantineOverrides.add(entry.source_key);
      quarantine.push({ ...evidence, reason: quarantineOverrides.get(entry.source_key) });
      continue;
    }
    const normalized = normalizeRackTablesModel(entry.source_text);
    if (!normalized.model) {
      quarantine.push({ ...evidence, reason: normalized.reason });
      continue;
    }
    definitions.push({
      id: `racktables-known-switches:${sysObjectId}`,
      sys_object_id: sysObjectId,
      match_type: "exact",
      claim_strength: "exact_model",
      confidence: "medium",
      enterprise_number: enterpriseNumber,
      model: normalized.model,
      product_family: null,
      claim_scope: "open-source-project-device-definition",
      source_id: "racktables-known-switches",
      declaration_line: entry.source_line,
      field_provenance: "racktables-static-label-normalization-v1",
      firmware_scope: "not_established"
    });
  }
  definitions.sort((left, right) => numericOidCompare(left.sys_object_id, right.sys_object_id));
  quarantine.sort((left, right) => numericOidCompare(left.sys_object_id, right.sys_object_id));
  rejections.sort((left, right) => numericOidCompare(left.sys_object_id, right.sys_object_id));
  const counts = {
    source_literal_entries: parsed.length,
    unique_source_keys: seenSourceKeys.size,
    exact_oid_candidates: definitions.length + quarantine.length,
    exact_model_definitions: definitions.length,
    quarantined_entries: quarantine.length,
    rejected_enterprise_roots: rejections.length,
    enterprise_families: new Set([...definitions, ...quarantine].map((record) => record.enterprise_number)).size
  };
  if (usedQuarantineOverrides.size !== quarantineOverrides.size) throw new Error("Unused quarantine override key");
  if (JSON.stringify(counts) !== JSON.stringify(manifest.expected_counts)) {
    throw new Error(`RackTables measured-count drift: ${JSON.stringify(counts)}`);
  }
  const sourceUrl = `https://github.com/RackTables/racktables/blob/${manifest.source_repository.commit}/${manifest.source_repository.source_artifact.path}`;
  const document = {
    schema_version: 1,
    dataset_id: manifest.dataset_id,
    snapshot_date: manifest.snapshot_date,
    layer: manifest.layer,
    publication_mode: "definition-only",
    raw_distribution: "not-provided",
    dataset_license: manifest.derived_dataset_license,
    source_manifest_sha256: canonicalJsonSha256(manifest),
    dataset_sha256: null,
    field_provenance_contracts: {
      "racktables-static-label-normalization-v1": {
        sys_object_id: "Exact enterprises-relative static numeric key expanded under 1.3.6.1.4.1; enterprise roots are rejected.",
        model: "mibvendor-authored bounded normalization of the RackTables leading label, retained only when a colon or comma creates an unambiguous boundary; port and switch summary suffixes are stripped.",
        enterprise_number: "First enterprises-relative arc cross-checked against the pinned IANA PEN snapshot.",
        firmware_scope: "Always not_established; the source contains no firmware-range evidence."
      }
    },
    rights_boundary: {
      repository_license_signal: manifest.source_repository.license_signal.spdx,
      source_text_included: false,
      source_code_included: false,
      raw_api_available: false,
      retained_license_paths: manifest.source_repository.license_signal.files.map((file) => file.retained_path)
    },
    counts,
    sources: [{
      id: "racktables-known-switches",
      layer: manifest.layer,
      repository: "RackTables/racktables",
      revision: manifest.source_repository.commit,
      revision_date: manifest.source_repository.commit_date,
      commit_signature_verified: manifest.source_repository.commit_signature_verified,
      source_path: manifest.source_repository.source_artifact.path,
      source_url: sourceUrl,
      git_blob_oid: manifest.source_repository.source_artifact.git_blob_oid,
      sha256: manifest.source_repository.source_artifact.sha256,
      repository_license_signal: manifest.source_repository.license_signal.spdx,
      publication_mode: "definition-only",
      raw_distribution: "not-provided"
    }],
    definitions,
    quarantine,
    rejections
  };
  document.dataset_sha256 = digestWithout(document, "dataset_sha256");
  return document;
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const penDocument = JSON.parse(await readFile(path.join(projectRoot, manifest.enterprise_registry.path), "utf8"));
  const repositoryRoot = path.resolve(projectRoot, process.env.RACKTABLES_IDENTITY_SOURCE ?? manifest.source_repository.local_path);
  const document = await buildProjectIdentityDefinitions(manifest, { repositoryRoot, penDocument });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...document.counts, dataset_sha256: document.dataset_sha256 })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
