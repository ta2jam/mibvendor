import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256 } from "./canonical-json.mjs";
import { classifyPinnedLicense } from "./lib/pinned-license-classifier.mjs";

export { classifyPinnedLicense } from "./lib/pinned-license-classifier.mjs";

const ENTERPRISE_OID = /^\.?1\.3\.6\.1\.4\.1\.(\d+)(?:\.\d+)*$/;
const PRIVATE_VALUE = /^(?:<private>|private|unknown|generic|null|none|n\/?a)$/i;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobOid(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

export function resolveManifestPath(root, manifestPath, field) {
  if (typeof manifestPath !== "string" || manifestPath.length === 0) {
    throw new Error(`${field} must be a non-empty relative path`);
  }
  if (path.isAbsolute(manifestPath)
    || path.posix.isAbsolute(manifestPath)
    || path.win32.isAbsolute(manifestPath)) {
    throw new Error(`${field} must be a relative path`);
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, manifestPath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)) {
    throw new Error(`${field} must stay within its root`);
  }
  return resolvedPath;
}

function normalizeOid(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(ENTERPRISE_OID);
  if (!match) return null;
  return { oid: `.${trimmed.replace(/^\./, "")}`, enterpriseNumber: Number(match[1]) };
}

function safeLabel(value, { maxLength = 160 } = {}) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maxLength || PRIVATE_VALUE.test(normalized)) return null;
  if (/<private>/i.test(normalized) || EMAIL_VALUE.test(normalized) || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function safeModel(value) {
  const model = safeLabel(value, { maxLength: 80 });
  if (!model) return null;
  if (/@|(?:https?|ftp):\/\/|\bwww\./i.test(model)) return null;
  if (/\b(?:serial(?:\s+number)?|s\/n)\s*[:=#]\s*\S+/i.test(model) || /\bSN\s*:\s*\S+/i.test(model)) return null;
  if (/\b(?:host(?:name)?|contact|location)\s*[:=#]\s*\S+/i.test(model)) return null;
  if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(model)) return null;
  if (/\b[0-9a-f]{2}(?:(?::|-)[0-9a-f]{2}){5}\b/i.test(model)) return null;
  if (/\b[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}\b/i.test(model)) return null;
  if (/\b[0-9a-f]{12}\b/i.test(model)) return null;
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(model)) return null;
  if (/\bCPU\b|\brunning at\b|\bLinux\s+\d+\.\d+.*#\d+/i.test(model)) return null;
  return model;
}

function pointerToken(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function lineAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function uniqueMatches(content, pattern, valueGroup) {
  const values = new Map();
  for (const match of content.matchAll(pattern)) {
    const value = safeLabel(match[valueGroup]);
    if (!value) continue;
    const current = values.get(value) ?? [];
    current.push(lineAt(content, match.index));
    values.set(value, current);
  }
  return values;
}

export function extractLibreNmsFixture(document, context) {
  const observations = [];
  const devices = document?.os?.discovery?.devices;
  if (!Array.isArray(devices)) return { observations, rejected: 0 };
  const entities = document?.["entity-physical"]?.discovery?.entPhysical;
  let rejected = 0;

  for (let index = 0; index < devices.length; index += 1) {
    const device = devices[index];
    const normalizedOid = normalizeOid(device?.sysObjectID);
    const model = safeModel(device?.hardware);
    if (!normalizedOid || !model) {
      rejected += 1;
      continue;
    }
    const platform = safeLabel(device?.os, { maxLength: 80 });
    const deviceClass = safeLabel(device?.type, { maxLength: 80 });
    const corroboratingPointers = [];
    if (Array.isArray(entities)) {
      for (let entityIndex = 0; entityIndex < entities.length; entityIndex += 1) {
        const entity = entities[entityIndex];
        if (!["chassis", "stack"].includes(String(entity?.entPhysicalClass).toLowerCase())) continue;
        if (safeLabel(entity?.entPhysicalModelName)?.toLowerCase() !== model.toLowerCase()) continue;
        corroboratingPointers.push(
          `/entity-physical/discovery/entPhysical/${entityIndex}/entPhysicalModelName`,
        );
      }
    }
    const basePointer = `/os/discovery/devices/${index}`;
    observations.push({
      sys_object_id: normalizedOid.oid,
      enterprise_number: normalizedOid.enterpriseNumber,
      model,
      family: null,
      platform,
      device_class: deviceClass,
      vendor_label: null,
      source_id: context.sourceId,
      match_method: "exact-sys-object-id-observation",
      claim_scope: "observation-only",
      usable_for: "corroboration",
      claim_strength: corroboratingPointers.length > 0
        ? "entity-corroborated-fixture-observation"
        : "single-fixture-observation",
      confidence: corroboratingPointers.length > 0 ? "high" : "medium",
      evidence: {
        source_path: context.sourcePath,
        git_blob_oid: context.gitBlobOid,
        source_sha256: context.sourceSha256,
        json_pointers: [
          `${basePointer}/sysObjectID`,
          `${basePointer}/hardware`,
          ...(platform ? [`${basePointer}/os`] : []),
          ...(deviceClass ? [`${basePointer}/type`] : []),
          ...corroboratingPointers,
        ],
        line_evidence: [],
        ent_physical_model_match_count: corroboratingPointers.length,
      },
    });
  }
  return { observations, rejected };
}

export function extractSnmpInfoLiteralFixture(content, context) {
  const oidMatches = uniqueMatches(
    content,
    /(["'])_id\1\s*=>\s*(["'])(\.?1\.3\.6\.1\.4\.1\.\d+(?:\.\d+)*)\2/g,
    3,
  );
  const modelMatches = uniqueMatches(
    content,
    /is\s*\(\s*\$test->\{info\}->model\(\)\s*,\s*(["'])([^"'\n]+)\1/g,
    2,
  );
  const vendorMatches = uniqueMatches(
    content,
    /is\s*\(\s*\$test->\{info\}->vendor\(\)\s*,\s*(["'])([^"'\n]+)\1/g,
    2,
  );
  for (const value of [...modelMatches.keys()]) {
    if (!safeModel(value) || /^(?:unknown|undef)$/i.test(value) || value.startsWith(".") || /^enterprises\./i.test(value)) {
      modelMatches.delete(value);
    }
  }
  for (const value of [...vendorMatches.keys()]) {
    if (/^undef$/i.test(value)) vendorMatches.delete(value);
  }

  const packageMatch = content.match(/package\s+(Test::SNMP::Info[^;]+);/);
  const unambiguous = oidMatches.size === 1
    && modelMatches.size === 1
    && vendorMatches.size <= 1
    && packageMatch;
  if (!unambiguous) return { observations: [], rejected: oidMatches.size > 0 || modelMatches.size > 0 ? 1 : 0 };

  const [[oidValue, oidLines]] = oidMatches.entries();
  const normalizedOid = normalizeOid(oidValue);
  const [[model, modelLines]] = modelMatches.entries();
  if (!normalizedOid || !model) return { observations: [], rejected: 1 };
  const vendorEntry = [...vendorMatches.entries()][0] ?? null;
  const packageName = packageMatch[1].replace(/^Test::/, "");
  const layer = packageName.match(/::Layer(\d)::/)?.[1] ?? null;

  return {
    rejected: 0,
    observations: [{
      sys_object_id: normalizedOid.oid,
      enterprise_number: normalizedOid.enterpriseNumber,
      model,
      family: null,
      platform: packageName,
      device_class: layer ? `layer-${layer}` : null,
      vendor_label: vendorEntry?.[0] ?? null,
      source_id: context.sourceId,
      match_method: "exact-sys-object-id-observation",
      claim_scope: "observation-only",
      usable_for: "corroboration",
      claim_strength: "literal-project-test-observation",
      confidence: "medium",
      evidence: {
        source_path: context.sourcePath,
        git_blob_oid: context.gitBlobOid,
        source_sha256: context.sourceSha256,
        json_pointers: [],
        line_evidence: [
          ...oidLines.map((line) => ({ field: "sys_object_id", line })),
          ...modelLines.map((line) => ({ field: "model", line })),
          ...(vendorEntry ? vendorEntry[1].map((line) => ({ field: "vendor_label", line })) : []),
        ].sort((left, right) => left.line - right.line || left.field.localeCompare(right.field)),
        ent_physical_model_match_count: 0,
      },
    }],
  };
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

function observationSortKey(observation) {
  return [
    observation.source_id,
    observation.model.toLowerCase(),
    observation.platform ?? "",
    observation.device_class ?? "",
    observation.vendor_label ?? "",
    observation.evidence.source_path,
    observation.evidence.json_pointers.join("|"),
  ].join("\u0000");
}

function materialKey(observation) {
  return JSON.stringify([
    observation.source_id,
    observation.model,
    observation.family,
    observation.platform,
    observation.device_class,
    observation.vendor_label,
    observation.match_method,
    observation.claim_strength,
    observation.confidence,
  ]);
}

function groupIdentities(observations, penNames, organizationKeys) {
  const byOid = new Map();
  for (const observation of observations) {
    const current = byOid.get(observation.sys_object_id) ?? [];
    current.push(observation);
    byOid.set(observation.sys_object_id, current);
  }
  const identities = [];
  for (const [oid, oidObservations] of byOid) {
    oidObservations.sort((left, right) => observationSortKey(left).localeCompare(observationSortKey(right)));
    const byMaterial = new Map();
    for (const observation of oidObservations) {
      const key = materialKey(observation);
      const group = byMaterial.get(key) ?? [];
      group.push(observation);
      byMaterial.set(key, group);
    }
    const candidates = [];
    for (const group of byMaterial.values()) {
      const first = group[0];
      const candidateProjection = {
        model: first.model,
        family: first.family,
        platform: first.platform,
        device_class: first.device_class,
        vendor_label: first.vendor_label,
        source_id: first.source_id,
        match_method: first.match_method,
        claim_scope: first.claim_scope,
        usable_for: first.usable_for,
        claim_strength: first.claim_strength,
        confidence: first.confidence,
        observations: group.map((item) => item.evidence),
      };
      candidates.push({
        candidate_id: `fixture_${canonicalJsonSha256({ oid, ...candidateProjection }).slice(0, 20)}`,
        ...candidateProjection,
      });
    }
    candidates.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
    const modelCount = new Set(candidates.map((candidate) => candidate.model.toLowerCase())).size;
    const enterpriseNumber = oidObservations[0].enterprise_number;
    identities.push({
      sys_object_id: oid,
      enterprise_number: enterpriseNumber,
      enterprise_organization_name: penNames.get(enterpriseNumber) ?? null,
      organization_key: organizationKeys.get(enterpriseNumber) ?? null,
      evidence_state: modelCount > 1 ? "conflicting_observations" : "single_observation",
      confidence: modelCount > 1
        ? "low"
        : candidates.some((candidate) => candidate.confidence === "high") ? "high" : "medium",
      candidate_count: candidates.length,
      candidates,
    });
  }
  return identities.sort((left, right) => compareOid(left.sys_object_id, right.sys_object_id));
}

function projectDigest(document) {
  const { document_sha256: _omitted, ...projection } = document;
  return canonicalJsonSha256(projection);
}

export function finalizeProjectFixtureDocument({
  manifest,
  observations,
  sourceSummaries,
  penNames,
  organizationKeys,
}) {
  const identities = groupIdentities([...observations], penNames, organizationKeys);
  const candidates = identities.flatMap((identity) => identity.candidates);
  const allEvidence = candidates.flatMap((candidate) => candidate.observations
    .map((evidence) => ({ source_id: candidate.source_id, evidence })));
  const counts = {
    input_files: sourceSummaries.reduce((sum, source) => sum + source.input_file_count, 0),
    files_with_observations: new Set(allEvidence.map(({ source_id, evidence }) => `${source_id}:${evidence.source_path}`)).size,
    observations: allEvidence.length,
    exact_oids: identities.length,
    identity_candidates: candidates.length,
    conflicting_exact_oids: identities.filter((identity) => identity.evidence_state === "conflicting_observations").length,
    corroborated_observations: allEvidence.filter(({ evidence }) => evidence.ent_physical_model_match_count > 0).length,
    identities_with_reviewed_organization_key: identities.filter((identity) => identity.organization_key !== null).length,
    rejected_input_records: sourceSummaries.reduce((sum, source) => sum + source.rejected_input_records, 0),
    by_source: Object.fromEntries(sourceSummaries
      .map((source) => [source.id, {
        input_files: source.input_file_count,
        files_with_observations: source.files_with_observations,
        observations: source.observation_count,
        rejected_input_records: source.rejected_input_records,
      }])
      .sort(([left], [right]) => left.localeCompare(right))),
  };
  const document = {
    schema_version: 1,
    dataset_id: manifest.dataset_id,
    generated_at: null,
    document_sha256: null,
    policy: structuredClone(manifest.policy),
    organization_mapping_snapshot: {
      repository: manifest.organization_mapping_snapshot.repository,
      revision: manifest.organization_mapping_snapshot.revision,
      path: manifest.organization_mapping_snapshot.path,
      git_blob_oid: manifest.organization_mapping_snapshot.git_blob_oid,
      sha256: manifest.organization_mapping_snapshot.sha256,
      reviewed_pen_links: manifest.organization_mapping_snapshot.reviewed_pen_links.length,
    },
    enterprise_registry_snapshot: structuredClone(manifest.enterprise_registry_snapshot),
    counts,
    sources: [...sourceSummaries].sort((left, right) => left.id.localeCompare(right.id)),
    identities,
  };
  document.document_sha256 = projectDigest(document);
  return document;
}

async function walkFiles(root, extension) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(extension)) files.push(absolute);
    }
  }
  await visit(root);
  return files.sort();
}

function gitTree(root, revision, inputRoot) {
  const output = execFileSync(
    "git",
    ["-C", root, "ls-tree", "-r", "-z", revision, "--", inputRoot],
    { encoding: "buffer" },
  );
  const entries = new Map();
  for (const item of output.toString("utf8").split("\0").filter(Boolean)) {
    const match = item.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/);
    if (match) entries.set(match[2], match[1]);
  }
  return entries;
}

async function loadSource(manifestSource, sourceRoot) {
  const actualRevision = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (actualRevision !== manifestSource.revision) {
    throw new Error(`${manifestSource.id} revision drift: ${actualRevision}`);
  }
  const inputRoot = resolveManifestPath(
    sourceRoot,
    manifestSource.input_root,
    `${manifestSource.id}.input_root`,
  );
  const tree = gitTree(sourceRoot, manifestSource.revision, manifestSource.input_root);
  const licenseBytes = new Map();
  for (const licenseFile of manifestSource.license_classifier.files) {
    const licensePath = resolveManifestPath(
      sourceRoot,
      licenseFile.path,
      `${manifestSource.id}.license_classifier.files[].path`,
    );
    licenseBytes.set(licenseFile.path, await readFile(licensePath));
  }
  const license = classifyPinnedLicense(manifestSource, licenseBytes);
  const files = await walkFiles(inputRoot, manifestSource.input_extension);
  if (files.length !== manifestSource.expected_input_files) {
    throw new Error(`${manifestSource.id} input count drift: ${files.length} != ${manifestSource.expected_input_files}`);
  }
  return { actualRevision, tree, license, files };
}

async function verifyOrganizationMapping(manifest, mappingRoot) {
  const snapshot = manifest.organization_mapping_snapshot;
  const bytes = execFileSync(
    "git",
    ["-C", mappingRoot, "show", `${snapshot.revision}:${snapshot.path}`],
    { encoding: "buffer" },
  );
  if (sha256(bytes) !== snapshot.sha256 || gitBlobOid(bytes) !== snapshot.git_blob_oid) {
    throw new Error("Organization mapping content drift");
  }
  const records = JSON.parse(bytes);
  const links = records.flatMap((record) => (record.pen ?? []).map((pen) => ({
    enterprise_number: Number(pen),
    organization_key: record.organizationKey,
  }))).sort((left, right) => left.enterprise_number - right.enterprise_number);
  if (JSON.stringify(links) !== JSON.stringify(snapshot.reviewed_pen_links)) {
    throw new Error("Organization mapping reviewed PEN links drift");
  }
  return new Map(links.map((link) => [link.enterprise_number, link.organization_key]));
}

export async function buildProjectFixtureDocument({
  root,
  manifest,
  sourceRoots,
  mappingRoot,
}) {
  const ianaPath = resolveManifestPath(
    root,
    manifest.enterprise_registry_snapshot.path,
    "enterprise_registry_snapshot.path",
  );
  const ianaBytes = await readFile(ianaPath);
  if (sha256(ianaBytes) !== manifest.enterprise_registry_snapshot.sha256) {
    throw new Error("IANA PEN snapshot content drift");
  }
  const iana = JSON.parse(ianaBytes);
  if (iana.records.length !== manifest.enterprise_registry_snapshot.record_count
    || iana.source_sha256 !== manifest.enterprise_registry_snapshot.upstream_content_sha256) {
    throw new Error("IANA PEN snapshot metadata drift");
  }
  const penNames = new Map(iana.records);
  const organizationKeys = await verifyOrganizationMapping(manifest, mappingRoot);
  const observations = [];
  const sourceSummaries = [];

  for (const manifestSource of manifest.sources) {
    const sourceRoot = sourceRoots.get(manifestSource.id);
    if (!sourceRoot) throw new Error(`Missing source root for ${manifestSource.id}`);
    const loaded = await loadSource(manifestSource, sourceRoot);
    let rejected = 0;
    const filesWithObservations = new Set();
    if (loaded.license.status === "approved") {
      for (const absolutePath of loaded.files) {
        const sourcePath = path.relative(sourceRoot, absolutePath).split(path.sep).join("/");
        const bytes = await readFile(absolutePath);
        const expectedBlob = loaded.tree.get(sourcePath);
        if (!expectedBlob || gitBlobOid(bytes) !== expectedBlob) {
          throw new Error(`${manifestSource.id} source file drift: ${sourcePath}`);
        }
        const context = {
          sourceId: manifestSource.id,
          sourcePath,
          gitBlobOid: expectedBlob,
          sourceSha256: sha256(bytes),
        };
        const extracted = manifestSource.parser === "librenms-project-json-v1"
          ? extractLibreNmsFixture(JSON.parse(bytes), context)
          : extractSnmpInfoLiteralFixture(bytes.toString("utf8"), context);
        rejected += extracted.rejected;
        if (extracted.observations.length > 0) filesWithObservations.add(sourcePath);
        observations.push(...extracted.observations);
      }
    }
    sourceSummaries.push({
      id: manifestSource.id,
      repository: manifestSource.repository,
      revision: manifestSource.revision,
      parser: manifestSource.parser,
      license: loaded.license,
      input_file_count: loaded.files.length,
      files_with_observations: filesWithObservations.size,
      observation_count: observations.filter((item) => item.source_id === manifestSource.id).length,
      rejected_input_records: rejected,
    });
  }

  const document = finalizeProjectFixtureDocument({
    manifest,
    observations,
    sourceSummaries,
    penNames,
    organizationKeys,
  });
  if (manifest.expected_measurements
    && JSON.stringify(document.counts) !== JSON.stringify(manifest.expected_measurements)) {
    throw new Error("Project fixture measured counts drift from reviewed manifest");
  }
  return document;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const manifestPath = path.join(root, "data", "device-identities", "project-fixtures-manifest.json");
  const outputPath = path.join(root, "data", "device-identities", "project-fixtures.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const sourceRoots = new Map([
    ["librenms-project-tests", process.env.LIBRENMS_SOURCE_DIR || path.join(root, ".local", "identity-sources", "librenms")],
    ["snmp-info-project-tests", process.env.SNMP_INFO_SOURCE_DIR || path.join(root, ".local", "identity-sources", "snmp-info")],
  ]);
  const mappingRoot = process.env.MACVENDOR_SOURCE_DIR || path.resolve(root, "..", "macvendor-zero");
  const document = await buildProjectFixtureDocument({ root, manifest, sourceRoots, mappingRoot });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(document.counts));
}
