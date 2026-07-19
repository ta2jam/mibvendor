import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  derivePublicationControlState,
  isSafePublicationReleaseId,
  publicationControlEventDigest,
  validatePublicationControls
} from "../../src/publication-controls.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const ACTIVATION_KEYS = new Set([
  "schema_version",
  "data_release",
  "predecessor_data_release",
  "candidate_generated_at",
  "activated_at",
  "application_release",
  "candidate_report_sha256",
  "documents",
  "publication_control_event_sha256",
  "activation_basis"
]);
const DOCUMENT_DIGEST_KEYS = new Set([
  "mib_catalog_sha256",
  "mib_objects_sha256",
  "source_catalog_sha256",
  "publication_controls_sha256"
]);
const REPORT_FILE_DIGESTS = new Map([
  ["data/mib-catalog.json", "mib_catalog_sha256"],
  ["data/mib-objects.json", "mib_objects_sha256"],
  ["data/source-catalog.json", "source_catalog_sha256"]
]);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function isTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
}

function sortedRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = row?.[key];
    if (typeof value === "string") counts[value] = (counts[value] ?? 0) + 1;
  }
  return sortedRecord(counts);
}

async function readRegularFile(filePath, label, failures) {
  try {
    const status = await lstat(filePath);
    if (status.isSymbolicLink() || !status.isFile()) {
      failures.push(`${label} must be a regular file, not a symlink or special file`);
      return null;
    }
    return await readFile(filePath);
  } catch (error) {
    failures.push(`${label} is missing or unreadable: ${error.message}`);
    return null;
  }
}

async function isRegularDirectory(directoryPath, label, failures) {
  try {
    const status = await lstat(directoryPath);
    if (status.isSymbolicLink() || !status.isDirectory()) {
      failures.push(`${label} must be a regular directory, not a symlink or special file`);
      return false;
    }
    return true;
  } catch (error) {
    failures.push(`${label} is missing or unreadable: ${error.message}`);
    return false;
  }
}

function parseJson(bytes, label, failures) {
  if (bytes === null) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    failures.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateDigest(value, label, failures) {
  if (!DIGEST_PATTERN.test(value ?? "")) failures.push(`${label} must be a lowercase SHA-256 digest`);
}

function parseSemver(value) {
  const match = typeof value === "string" ? value.match(SEMVER_PATTERN) : null;
  if (!match) return null;
  const core = match.slice(1, 4).map(Number);
  const prerelease = match[4] === undefined ? null : match[4].split(".");
  if (core.some((part) => !Number.isSafeInteger(part))) return null;
  if (prerelease?.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
  return {
    core,
    prerelease
  };
}

function compareSemver(left, right) {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] < right.core[index] ? -1 : 1;
  }
  if (left.prerelease === null || right.prerelease === null) {
    if (left.prerelease === right.prerelease) return 0;
    return left.prerelease === null ? 1 : -1;
  }
  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      if (leftPart.length !== rightPart.length) return leftPart.length < rightPart.length ? -1 : 1;
      return leftPart < rightPart ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function isReleaseTagEvidenceUrl(value, version) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname.endsWith(`/releases/tag/v${version}`) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function validateCatalogCounts(catalog, objects, sources, report, failures) {
  const failureCountBeforeShapeChecks = failures.length;
  if (!Array.isArray(catalog?.modules)) failures.push("Active MIB catalog modules must be an array");
  if (!Array.isArray(objects?.objects)) failures.push("Active object catalog objects must be an array");
  if (!Array.isArray(sources?.sources)) failures.push("Active source catalog sources must be an array");
  if (!catalog?.counts || typeof catalog.counts !== "object" || Array.isArray(catalog.counts)) failures.push("Active MIB catalog counts are missing");
  if (!report?.counts || typeof report.counts !== "object" || Array.isArray(report.counts)) failures.push("Release report counts are missing");
  if (!report?.readiness || typeof report.readiness !== "object" || Array.isArray(report.readiness)) failures.push("Release report readiness is missing");
  if (failures.length !== failureCountBeforeShapeChecks) return;

  const modules = catalog.modules;
  const objectRows = objects.objects;
  const sourceRows = sources.sources;
  const moduleIds = new Set();
  const sourceIds = new Set();
  const objectIds = new Set();
  let stableIdCollisions = 0;

  for (const source of sourceRows) {
    if (typeof source?.id !== "string" || !source.id) failures.push("Active source catalog contains an invalid source ID");
    else if (sourceIds.has(source.id)) failures.push(`Active source catalog contains duplicate source ID ${source.id}`);
    else sourceIds.add(source.id);
  }
  for (const module of modules) {
    if (typeof module?.id !== "string" || !module.id) failures.push("Active MIB catalog contains an invalid module ID");
    else if (moduleIds.has(module.id)) failures.push(`Active MIB catalog contains duplicate module ID ${module.id}`);
    else moduleIds.add(module.id);
    if (!sourceIds.has(module?.source_id)) failures.push(`Active module ${module?.id ?? "<unknown>"} refers to an unknown source`);
  }
  for (const object of objectRows) {
    if (typeof object?.id !== "string" || !object.id) failures.push("Active object catalog contains an invalid stable ID");
    else if (objectIds.has(object.id)) stableIdCollisions += 1;
    else objectIds.add(object.id);
    if (!moduleIds.has(object?.module)) failures.push(`Active object ${object?.id ?? "<unknown>"} refers to an unknown module`);
  }

  const notifications = objectRows.filter((object) => object.kind === "notification" || object.kind === "notification-type").length;
  const publisherCounts = countBy(modules, "publisher");
  const moduleModeCounts = countBy(modules, "publication_mode");
  const directorySourceCount = sourceRows.filter((source) => source.publication_mode === "directory-only").length;
  const expectedPublicationModes = {
    redistributable: moduleModeCounts.redistributable ?? 0,
    "metadata-only": moduleModeCounts["metadata-only"] ?? 0,
    "directory-only": directorySourceCount
  };

  if (catalog.counts.modules !== modules.length) failures.push("Active module count differs from catalog rows");
  if (catalog.counts.resolved_objects !== objectRows.length) failures.push("Active object count differs from object rows");
  if (catalog.counts.notifications !== notifications) failures.push("Active notification count differs from object rows");
  if (catalog.counts.stable_object_id_collisions !== stableIdCollisions) failures.push("Active stable-ID collision count differs from object rows");
  if (JSON.stringify(catalog.counts.publishers) !== JSON.stringify(publisherCounts)) failures.push("Active publisher counts differ from module rows");
  if (JSON.stringify(catalog.counts.publication_modes) !== JSON.stringify(expectedPublicationModes)) failures.push("Active publication-mode counts differ from module/source rows");

  if (report.counts.final_modules !== modules.length) failures.push("Release report module count differs from the active catalog");
  if (report.counts.final_objects !== objectRows.length) failures.push("Release report object count differs from the active object catalog");
  if (report.counts.textual_conventions !== catalog.counts.textual_conventions) failures.push("Release report textual-convention count differs from the active catalog");
  if (report.counts.notifications !== catalog.counts.notifications) failures.push("Release report notification count differs from the active catalog");
  if (report.counts.stable_object_id_collisions !== 0 || catalog.counts.stable_object_id_collisions !== 0 || stableIdCollisions !== 0) {
    failures.push("Active release has a non-zero stable-ID collision count");
  }
  if (!Array.isArray(report.object_id_collisions) || report.object_id_collisions.length !== 0) failures.push("Release report must disclose an empty stable-ID collision list");
  if (report.readiness.activation_ready !== true || report.readiness.stable_object_ids_unique !== true) failures.push("Release report is not activation-ready and collision-free");
  if (report.readiness.final_module_count !== modules.length) failures.push("Release readiness module count differs from the active catalog");
  if (report.counts.active_modules_preserved + report.counts.promoted_modules !== report.counts.final_modules) failures.push("Release report module arithmetic is inconsistent");
  if (!Array.isArray(report.selected) || report.selected.length !== report.counts.promoted_modules) failures.push("Release report promoted-module count differs from selected rows");
  if (Array.isArray(report.selected)) {
    const selectedModules = new Set();
    let promotedObjects = 0;
    for (const selected of report.selected) {
      const selectedModule = selected?.module;
      if (selectedModules.has(selectedModule)) failures.push(`Release report selects module ${selectedModule} more than once`);
      selectedModules.add(selectedModule);
      if (!moduleIds.has(selectedModule)) failures.push(`Release report selects unknown module ${selectedModule}`);
      if (!sourceIds.has(selected?.source_id)) failures.push(`Release report selects unknown source ${selected?.source_id}`);
      if (!Number.isSafeInteger(selected?.resolved_objects) || selected.resolved_objects < 0) failures.push(`Release report has an invalid object count for ${selectedModule}`);
      else promotedObjects += selected.resolved_objects;
    }
    if (promotedObjects !== report.counts.promoted_objects) failures.push("Release report promoted-object count differs from selected rows");
  }
}

export async function validateActiveReleaseEvidence(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const failures = [];
  const dataDirectory = path.join(root, "data");
  const releasesRoot = path.join(dataDirectory, "releases");
  const [dataDirectorySafe, releasesRootSafe] = await Promise.all([
    isRegularDirectory(dataDirectory, "data directory", failures),
    isRegularDirectory(releasesRoot, "release evidence root", failures)
  ]);
  if (!dataDirectorySafe || !releasesRootSafe) return { ok: false, failures, summary: null };
  const paths = {
    version: path.join(root, "VERSION"),
    catalog: path.join(root, "data", "mib-catalog.json"),
    objects: path.join(root, "data", "mib-objects.json"),
    sources: path.join(root, "data", "source-catalog.json"),
    controls: path.join(root, "data", "publication-controls.json")
  };
  const [versionBytes, catalogBytes, objectBytes, sourceBytes, currentControlBytes] = await Promise.all([
    readRegularFile(paths.version, "VERSION", failures),
    readRegularFile(paths.catalog, "active MIB catalog", failures),
    readRegularFile(paths.objects, "active object catalog", failures),
    readRegularFile(paths.sources, "active source catalog", failures),
    readRegularFile(paths.controls, "current publication controls", failures)
  ]);
  const version = versionBytes?.toString("utf8").trim() ?? null;
  const catalog = parseJson(catalogBytes, "active MIB catalog", failures);
  const objects = parseJson(objectBytes, "active object catalog", failures);
  const sources = parseJson(sourceBytes, "active source catalog", failures);
  const currentControls = parseJson(currentControlBytes, "current publication controls", failures);
  const releaseId = catalog?.data_release;

  if (!isSafePublicationReleaseId(releaseId)) {
    failures.push("Active data release ID is unsafe; release evidence path was not opened");
    return { ok: false, failures, summary: null };
  }
  if (objects?.data_release !== releaseId || sources?.data_release !== releaseId || currentControls?.active_data_release !== releaseId) {
    failures.push("Active catalog, object, source, and publication-control release IDs differ");
  }

  const resolvedReleasesRoot = path.resolve(releasesRoot);
  const releaseDirectory = path.resolve(resolvedReleasesRoot, releaseId);
  if (path.dirname(releaseDirectory) !== resolvedReleasesRoot) {
    failures.push("Active release evidence path escapes data/releases");
    return { ok: false, failures, summary: null };
  }
  if (!await isRegularDirectory(releaseDirectory, "active release evidence directory", failures)) {
    return { ok: false, failures, summary: null };
  }

  const activationPath = path.join(releaseDirectory, "activation.json");
  const reportPath = path.join(releaseDirectory, "corpus-release-report.json");
  const snapshotPath = path.join(releaseDirectory, "publication-controls-at-activation.json");
  const [activationBytes, reportBytes, snapshotBytes] = await Promise.all([
    readRegularFile(activationPath, "activation evidence", failures),
    readRegularFile(reportPath, "corpus release report", failures),
    readRegularFile(snapshotPath, "publication-control activation snapshot", failures)
  ]);
  const activation = parseJson(activationBytes, "activation evidence", failures);
  const report = parseJson(reportBytes, "corpus release report", failures);
  const snapshot = parseJson(snapshotBytes, "publication-control activation snapshot", failures);
  if (!activation || !report || !snapshot || !catalog || !objects || !sources || !currentControls || !version) {
    return { ok: false, failures, summary: null };
  }

  if (!exactKeys(activation, ACTIVATION_KEYS)) failures.push("Activation evidence has missing or unknown schema-1 fields");
  if (!exactKeys(activation.documents, DOCUMENT_DIGEST_KEYS)) failures.push("Activation document digests have missing or unknown fields");
  if (activation.schema_version !== 1) failures.push("Activation evidence schema version must be 1");
  if (activation.data_release !== releaseId || report.release_id !== releaseId || snapshot.active_data_release !== releaseId) failures.push("Activation evidence, report, snapshot, and active release IDs differ");
  if (!isSafePublicationReleaseId(activation.predecessor_data_release) || activation.predecessor_data_release === releaseId) failures.push("Activation predecessor release ID is unsafe or equals the active release");
  if (report.baseline_data_release !== activation.predecessor_data_release) failures.push("Release report baseline differs from the activation predecessor");
  if (!isTimestamp(activation.candidate_generated_at) || activation.candidate_generated_at !== report.generated_at) failures.push("Candidate generation timestamp differs between activation evidence and report");
  if (!isTimestamp(activation.activated_at)) failures.push("Activation timestamp is invalid");
  if (Number.isFinite(Date.parse(activation.candidate_generated_at)) && Number.isFinite(Date.parse(activation.activated_at))
    && Date.parse(activation.activated_at) < Date.parse(activation.candidate_generated_at)) failures.push("Activation predates candidate generation");
  const activationApplicationRelease = parseSemver(activation.application_release);
  const consumerApplicationRelease = parseSemver(version);
  if (!activationApplicationRelease) failures.push("Activation application release is not a supported semantic version");
  if (!consumerApplicationRelease) failures.push("VERSION is not a supported semantic version");
  if (activationApplicationRelease && consumerApplicationRelease
    && compareSemver(consumerApplicationRelease, activationApplicationRelease) < 0) {
    failures.push("VERSION predates the application release that activated this data release");
  }
  if (typeof activation.activation_basis !== "string" || !activation.activation_basis.trim()) failures.push("Activation basis is missing");

  validateDigest(activation.candidate_report_sha256, "Candidate report digest", failures);
  validateDigest(activation.publication_control_event_sha256, "Publication-control event digest", failures);
  for (const [key, value] of Object.entries(activation.documents ?? {})) validateDigest(value, `Activation document digest ${key}`, failures);
  if (reportBytes && digest(reportBytes) !== activation.candidate_report_sha256) failures.push("Corpus release report SHA-256 differs from activation evidence");
  const byteDigests = {
    mib_catalog_sha256: catalogBytes && digest(catalogBytes),
    mib_objects_sha256: objectBytes && digest(objectBytes),
    source_catalog_sha256: sourceBytes && digest(sourceBytes),
    publication_controls_sha256: snapshotBytes && digest(snapshotBytes)
  };
  for (const [key, actual] of Object.entries(byteDigests)) {
    if (actual && activation.documents?.[key] !== actual) failures.push(`${key} differs from the exact activated bytes`);
  }
  if (!report.files || typeof report.files !== "object" || Array.isArray(report.files)
    || Object.keys(report.files).length !== REPORT_FILE_DIGESTS.size) failures.push("Release report file-digest inventory is incomplete or contains unknown paths");
  for (const [filePath, activationKey] of REPORT_FILE_DIGESTS) {
    if (report.files?.[filePath] !== activation.documents?.[activationKey]) failures.push(`Release report digest differs for ${filePath}`);
  }

  validateCatalogCounts(catalog, objects, sources, report, failures);

  const sourceIds = new Set((Array.isArray(sources.sources) ? sources.sources : []).map((source) => source.id));
  const moduleIds = new Set((Array.isArray(catalog.modules) ? catalog.modules : []).map((module) => module.id));
  const activationEventsAreObjects = Array.isArray(snapshot.events)
    && snapshot.events.every((event) => event && typeof event === "object" && !Array.isArray(event));
  const currentEventsAreObjects = Array.isArray(currentControls.events)
    && currentControls.events.every((event) => event && typeof event === "object" && !Array.isArray(event));
  if (!activationEventsAreObjects) failures.push("Activation publication controls require an array of event objects");
  else {
    for (const failure of validatePublicationControls(snapshot, { releaseId, sourceIds, moduleIds })) {
      failures.push(`Activation publication controls: ${failure}`);
    }
  }
  if (!currentEventsAreObjects) failures.push("Current publication controls require an array of event objects");
  else {
    for (const failure of validatePublicationControls(currentControls, { releaseId, sourceIds, moduleIds })) {
      failures.push(`Current publication controls: ${failure}`);
    }
  }

  const snapshotEvents = activationEventsAreObjects ? snapshot.events : [];
  const promotionIndex = snapshotEvents.findIndex((event) => event?.event_sha256 === activation.publication_control_event_sha256);
  const promotion = promotionIndex >= 0 ? snapshotEvents[promotionIndex] : null;
  if (!promotion) failures.push("Activation promotion event digest is absent from the activation snapshot");
  else {
    if (publicationControlEventDigest(promotion) !== promotion.event_sha256) failures.push("Activation promotion event digest is invalid");
    if (promotion.action !== "promotion" || promotion.target_type !== "release" || promotion.target_id !== releaseId) failures.push("Activation event is not a promotion of the active release");
    if (promotion.occurred_at !== activation.activated_at || snapshot.updated_at !== activation.activated_at) failures.push("Promotion, snapshot, and activation timestamps differ");
    if (!isReleaseTagEvidenceUrl(promotion.evidence_url, activation.application_release)) failures.push("Activation application release differs from the promotion evidence tag");
    if (promotionIndex !== snapshotEvents.length - 1) failures.push("Activation promotion event must end the activation snapshot");
    const priorState = derivePublicationControlState(snapshotEvents.slice(0, promotionIndex));
    if (priorState.activeRelease !== activation.predecessor_data_release) failures.push("Promotion predecessor differs from the prior publication-control release");
  }

  if (!Array.isArray(currentControls.events) || !Array.isArray(snapshot.events) || currentControls.events.length < snapshot.events.length) {
    failures.push("Current publication-control history is shorter than the activation snapshot");
  } else {
    for (let index = 0; index < snapshot.events.length; index += 1) {
      if (JSON.stringify(currentControls.events[index]) !== JSON.stringify(snapshot.events[index])) {
        failures.push(`Current publication-control history replaced activation event ${index + 1}`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    summary: {
      release_id: releaseId,
      predecessor_data_release: activation.predecessor_data_release,
      application_release: activation.application_release,
      consumer_application_release: version,
      modules: Array.isArray(catalog.modules) ? catalog.modules.length : 0,
      objects: Array.isArray(objects.objects) ? objects.objects.length : 0,
      sources: Array.isArray(sources.sources) ? sources.sources.length : 0
    }
  };
}
