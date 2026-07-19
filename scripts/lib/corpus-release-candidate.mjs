import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import {
  ARTIFACT_NOTICE_EVIDENCE_CANONICALIZATION,
  ARTIFACT_RESTRICTIVE_NOTICE_SCANNER_VERSION,
  scanArtifactRestrictiveNotices
} from "./artifact-restrictive-notices.mjs";

const APPROVED_DISCOVERY_LICENSE = "license-derived-approval";
const APPROVED_RIGHTS_REVIEW = "approved-by-repository-license-signal";
const PUBLIC_FIELDS = ["module", "oid", "symbol", "syntax", "access", "description", "source_url", "checksum", "raw_file"];
const RESERVED_GRAMMAR_SYMBOLS = new Set(["ACCESS", "AUGMENTS", "DEFVAL", "DESCRIPTION", "INDEX", "MAX-ACCESS", "MIN-ACCESS", "REFERENCE", "STATUS", "SYNTAX", "UNITS"]);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function digestFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function stableSort(values, key = (value) => value) {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

function parseModuleName(text) {
  return text.match(/^\s*(?:--[^\n]*\n\s*)*([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS(?:\s+IMPLICIT\s+TAGS)?\s*::=\s*BEGIN/m)?.[1]
    ?? text.match(/^\s*([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS(?:\s+IMPLICIT\s+TAGS)?\s*::=\s*BEGIN/m)?.[1]
    ?? null;
}

function countTextualConventions(text) {
  return [...text.replace(/--[^\r\n]*/g, "").matchAll(/\b[A-Za-z][A-Za-z0-9-]*\s*::=\s*TEXTUAL-CONVENTION\b/g)].length;
}

function safeRelative(candidate) {
  if (typeof candidate !== "string" || path.isAbsolute(candidate)) return false;
  const normalized = path.normalize(candidate);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readGzipJson(file) {
  return JSON.parse(gunzipSync(await readFile(file)).toString("utf8"));
}

function rejection(module, artifactId, reasons, stage = "artifact-gate") {
  return { module, artifact_id: artifactId, stage, reasons: [...new Set(reasons)].sort() };
}

function preservedArtifactNoticeConflict(module, findings) {
  return {
    module: module.id,
    artifact_id: `active:${module.raw_path}`,
    source_id: module.source_id,
    artifact_sha256: module.artifact_sha256,
    raw_path: module.raw_path,
    stage: "preserved-artifact-notice-gate",
    reasons: ["artifact-restrictive-notice-conflict"],
    restrictive_notice_conflicts: findings
  };
}

function caseFoldedPublicObjectId(object) {
  return `${object.module}--${object.symbol}`.toLowerCase();
}

function publicObjectIdCollisions(objects) {
  const objectsByPublicId = new Map();
  for (const object of objects) {
    const publicId = caseFoldedPublicObjectId(object);
    const values = objectsByPublicId.get(publicId) ?? [];
    values.push(object);
    objectsByPublicId.set(publicId, values);
  }
  return stableSort([...objectsByPublicId]
    .filter(([, values]) => values.length > 1)
    .map(([id, values]) => ({
      id,
      module: values[0].module,
      symbols: stableSort([...new Set(values.map((object) => object.symbol))]),
      oids: stableSort(values.map((object) => object.oid))
    })), (collision) => collision.id);
}

function modulePublisher(source) {
  return source.repository ?? source.id;
}

function sourceCatalogRow(source, discovery, generatedAt) {
  const licenseFile = source.license.files[0];
  return {
    id: source.id,
    publisher: source.repository,
    official_source_url: `https://github.com/${source.repository}/tree/${source.commit}`,
    rights_evidence_url: licenseFile.pinned_url,
    checked_at: generatedAt.slice(0, 10),
    publication_mode: "redistributable",
    content_intake: "approved",
    scopes: {
      metadata_index: "approved",
      rendered_text: "approved",
      api_output: "approved",
      raw_download: "approved",
      bulk_export: "approved"
    },
    public_fields: PUBLIC_FIELDS,
    reason: `Pinned ${source.license.spdx} repository-license signal at ${source.commit}; embedded third-party ownership remains subject to takedown review.`,
    source_revision: source.commit,
    immutable_source_url: discovery.commit_url,
    license: {
      spdx: source.license.spdx,
      name: source.license.name,
      basis: source.license.basis,
      files: stableSort(source.license.files, (file) => file.source_path).map((file) => ({
        source_path: file.source_path,
        pinned_url: file.pinned_url,
        git_blob_oid: file.git_blob_oid,
        sha256: file.sha256
      }))
    }
  };
}

function summarizeCounts(modules, sources, objects, textualConventions, objectIdCollisions) {
  const publishers = {};
  for (const module of modules) publishers[module.publisher] = (publishers[module.publisher] ?? 0) + 1;
  const publicationModes = { redistributable: 0, "metadata-only": 0, "directory-only": 0 };
  for (const module of modules) publicationModes[module.publication_mode] = (publicationModes[module.publication_mode] ?? 0) + 1;
  publicationModes["directory-only"] = sources.filter((source) => source.publication_mode === "directory-only").length;
  return {
    modules: modules.length,
    resolved_objects: objects.length,
    textual_conventions: textualConventions,
    notifications: objects.filter((object) => object.kind === "notification" || object.kind === "notification-type").length,
    stable_object_id_collisions: objectIdCollisions.length,
    publishers: Object.fromEntries(Object.entries(publishers).sort(([left], [right]) => left.localeCompare(right))),
    publication_modes: publicationModes
  };
}

export async function loadReleaseInputs(inputRoot) {
  const data = path.join(inputRoot, "data");
  const [activeCatalog, activeObjects, activeSources, discovery, intake, manifest, analysis, stagedObjects] = await Promise.all([
    readJson(path.join(data, "mib-catalog.json")),
    readJson(path.join(data, "mib-objects.json")),
    readJson(path.join(data, "source-catalog.json")),
    readJson(path.join(data, "source-discovery.json")),
    readJson(path.join(data, "license-derived-intake.json")),
    readJson(path.join(data, "corpus-expansion-candidates.json")),
    readJson(path.join(data, "raw-mib-analysis.json")),
    readGzipJson(path.join(data, "raw-mib-objects-staging.json.gz"))
  ]);
  return { inputRoot, activeCatalog, activeObjects, activeSources, discovery, intake, manifest, analysis, stagedObjects };
}

export async function planReleaseCandidate(inputs, { releaseId, generatedAt, minimumModules = null } = {}) {
  if (!releaseId || !generatedAt) throw new Error("releaseId and generatedAt are required");
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error("generatedAt must be an ISO-8601 timestamp");
  if (minimumModules !== null && (!Number.isSafeInteger(minimumModules) || minimumModules < 1)) throw new Error("minimumModules must be a positive integer or null");
  if (inputs.activeCatalog.data_release !== inputs.activeObjects.data_release
    || inputs.activeCatalog.data_release !== inputs.activeSources.data_release) {
    throw new Error("active catalog releases differ");
  }
  if (inputs.manifest.baseline_data_release !== inputs.activeCatalog.data_release
    || inputs.analysis.baseline_data_release !== inputs.activeCatalog.data_release) {
    throw new Error("staging baseline does not match the active release");
  }

  const activeIds = new Set(inputs.activeCatalog.modules.map((module) => module.id));
  const discoverySources = new Map(inputs.discovery.sources.map((source) => [source.id, source]));
  const discoveryCandidates = new Map(inputs.discovery.candidates.map((candidate) => [candidate.id, candidate]));
  const intakeSources = new Map(inputs.intake.sources.map((source) => [source.id, source]));
  const intakeArtifacts = new Map(inputs.intake.artifacts.map((artifact) => [artifact.id, artifact]));
  const analysisByArtifact = new Map(inputs.analysis.modules.map((module) => [module.selected_artifact_id, module]));
  const manifestByModule = new Map(inputs.manifest.modules.map((module) => [module.module, module]));
  const stagedObjectsByArtifact = new Map();
  for (const object of inputs.stagedObjects.objects) {
    const values = stagedObjectsByArtifact.get(object.source_artifact_id) ?? [];
    values.push(object);
    stagedObjectsByArtifact.set(object.source_artifact_id, values);
  }

  const sourceGateReasons = new Map();
  for (const source of inputs.intake.sources) {
    const reasons = [];
    if (!/^[a-z0-9][a-z0-9-]*$/.test(source.id)) reasons.push("unsafe-source-id");
    if (!source.license.files?.length) reasons.push("license-file-missing");
    for (const license of source.license.files ?? []) {
      if (!safeRelative(license.source_path) || !safeRelative(license.staged_path)) {
        reasons.push("unsafe-license-path");
        continue;
      }
      try {
        if (await digestFile(path.join(inputs.inputRoot, "data", license.staged_path)) !== license.sha256) reasons.push("license-checksum-mismatch");
      } catch {
        reasons.push("license-file-missing");
      }
      if (!license.pinned_url?.startsWith("https://") || !license.pinned_url.includes(source.commit)) reasons.push("license-url-not-immutable");
    }
    sourceGateReasons.set(source.id, [...new Set(reasons)].sort());
  }

  const preservedArtifactNoticeConflicts = [];
  for (const module of stableSort(inputs.activeCatalog.modules, (item) => item.id)) {
    if (!safeRelative(module.raw_path)) continue;
    try {
      const findings = scanArtifactRestrictiveNotices(await readFile(path.join(inputs.inputRoot, "data", module.raw_path), "utf8"));
      if (findings.length) preservedArtifactNoticeConflicts.push(preservedArtifactNoticeConflict(module, findings));
    } catch {
      // Candidate verification already fails closed on an unreadable preserved raw artifact.
    }
  }

  const artifactRejections = [];
  const eligibleByModule = new Map();
  for (const artifact of stableSort(inputs.intake.artifacts, (item) => item.id)) {
    if (artifact.retention_state === "metadata-only-evidence") {
      artifactRejections.push({
        ...rejection(artifact.module, artifact.id, ["artifact-restrictive-notice-conflict"], "artifact-notice-gate"),
        restrictive_notice_conflicts: artifact.restrictive_notice_conflicts ?? []
      });
      continue;
    }
    if (artifact.module === null) {
      artifactRejections.push(rejection(null, artifact.id, ["module-declaration-missing"]));
      continue;
    }
    if (activeIds.has(artifact.module)) {
      artifactRejections.push(rejection(artifact.module, artifact.id, ["active-variant-preserved"], "active-preservation"));
      continue;
    }
    const manifestModule = manifestByModule.get(artifact.module);
    if (!manifestModule?.variants?.some((variant) => variant.artifact_id === artifact.id && variant.format === "raw")) {
      artifactRejections.push(rejection(artifact.module, artifact.id, ["candidate-manifest-variant-missing"]));
      continue;
    }
    if (manifestModule.selected_format !== "raw" || manifestModule.selected_artifact_id !== artifact.id) continue;
    const reasons = [];
    const source = intakeSources.get(artifact.source_id);
    const discoveredSource = discoverySources.get(artifact.source_id);
    const discoveredArtifact = discoveryCandidates.get(artifact.id);
    const analysis = analysisByArtifact.get(artifact.id);
    const manifestVariant = manifestModule?.variants?.find((variant) => variant.artifact_id === artifact.id && variant.format === "raw");
    reasons.push(...(sourceGateReasons.get(artifact.source_id) ?? ["source-provenance-missing"]));
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(artifact.module) || !safeRelative(artifact.source_path)) reasons.push("unsafe-artifact-identity-or-path");
    if (!source || !discoveredSource) reasons.push("source-provenance-missing");
    if (source && (source.license.basis !== "repository-license-signal" || !source.license.spdx || source.license.spdx === "NOASSERTION")) reasons.push("license-signal-not-approved");
    if (discoveredSource && discoveredSource.repository_license.status !== APPROVED_DISCOVERY_LICENSE) reasons.push("discovery-license-not-approved");
    if (discoveredSource && source && (discoveredSource.commit !== source.commit || discoveredSource.repository_license.spdx !== source.license.spdx)) reasons.push("source-license-snapshot-mismatch");
    if (!discoveredArtifact
      || discoveredArtifact.rights_review !== APPROVED_RIGHTS_REVIEW
      || discoveredArtifact.publication_mode !== "redistributable") reasons.push("artifact-rights-signal-not-approved");
    if (discoveredArtifact && (discoveredArtifact.path !== artifact.source_path
      || discoveredArtifact.pinned_url !== artifact.pinned_url
      || discoveredArtifact.git_blob_oid !== artifact.git_blob_oid)) reasons.push("artifact-discovery-provenance-mismatch");
    if (artifact.publication_mode !== "redistributable" || artifact.license_basis !== "repository-license-signal") reasons.push("artifact-publication-policy-not-approved");
    if (!artifact.pinned_url?.startsWith("https://") || !artifact.pinned_url.includes(artifact.source_revision)) reasons.push("artifact-url-not-immutable");
    if (!manifestVariant) reasons.push("candidate-manifest-variant-missing");
    if (!analysis) reasons.push("parser-analysis-missing");
    if (analysis) {
      if (analysis.module !== artifact.module || analysis.artifact_sha256 !== artifact.artifact_sha256) reasons.push("parser-artifact-identity-mismatch");
      if (analysis.parser_status !== "static-pass") reasons.push("parser-not-static-pass");
      if (analysis.declared_object_count !== analysis.resolved_object_count || analysis.unresolved_object_count !== 0) reasons.push("parser-resolution-incomplete");
      if (analysis.duplicate_symbol_count !== 0) reasons.push("duplicate-symbol-diagnostic");
      if (analysis.missing_dependency_count !== 0) reasons.push("missing-dependency-diagnostic");
      if ((stagedObjectsByArtifact.get(artifact.id)?.length ?? 0) !== analysis.resolved_object_count) reasons.push("staged-object-count-mismatch");
    }
    const stagedPublicIdCollisions = publicObjectIdCollisions(stagedObjectsByArtifact.get(artifact.id) ?? []);
    if (stagedPublicIdCollisions.length) reasons.push("duplicate-case-folded-public-object-id");
    if (!safeRelative(artifact.staged_path)) reasons.push("unsafe-staged-path");
    let rawBytes = null;
    if (safeRelative(artifact.staged_path)) {
      try {
        rawBytes = await readFile(path.join(inputs.inputRoot, "data", artifact.staged_path));
        if (digest(rawBytes) !== artifact.artifact_sha256 || artifact.source_sha256 !== artifact.artifact_sha256) reasons.push("artifact-checksum-mismatch");
        if (parseModuleName(rawBytes.toString("utf8")) !== artifact.module) reasons.push("module-declaration-mismatch");
      } catch {
        reasons.push("staged-artifact-missing");
      }
    }
    const restrictiveNoticeConflicts = rawBytes === null ? [] : scanArtifactRestrictiveNotices(rawBytes.toString("utf8"));
    if (restrictiveNoticeConflicts.length) reasons.push("artifact-restrictive-notice-conflict");
    if (reasons.length) {
      artifactRejections.push({
        ...rejection(
          artifact.module,
          artifact.id,
          reasons,
          restrictiveNoticeConflicts.length
            ? "artifact-notice-gate"
            : stagedPublicIdCollisions.length
              ? "object-identity-gate"
              : "artifact-gate"
        ),
        ...(stagedPublicIdCollisions.length ? { public_object_id_collisions: stagedPublicIdCollisions } : {}),
        ...(restrictiveNoticeConflicts.length ? { restrictive_notice_conflicts: restrictiveNoticeConflicts } : {})
      });
      continue;
    }
    const values = eligibleByModule.get(artifact.module) ?? [];
    values.push({ artifact, source, discovery: discoveredSource, analysis, rawBytes, manifestModule });
    eligibleByModule.set(artifact.module, values);
  }

  const safeCandidates = new Map();
  for (const [module, eligible] of stableSort([...eligibleByModule], ([name]) => name)) {
    if (eligible.length !== 1) throw new Error(`manifest selected more than one raw artifact for ${module}`);
    safeCandidates.set(module, eligible[0]);
  }
  for (const manifestModule of inputs.manifest.modules) {
    if (activeIds.has(manifestModule.module) || manifestModule.selected_format !== "raw") continue;
    const artifact = intakeArtifacts.get(manifestModule.selected_artifact_id);
    if (!artifact) artifactRejections.push(rejection(manifestModule.module, manifestModule.selected_artifact_id, ["manifest-selected-artifact-missing"], "manifest-selection"));
  }

  const selectedNames = new Set(safeCandidates.keys());
  const dependencyRejections = [];
  const dependants = new Map();
  for (const [module, candidate] of safeCandidates) {
    for (const dependency of candidate.analysis.dependencies.map((item) => item.module)) {
      const values = dependants.get(dependency) ?? new Set();
      values.add(module);
      dependants.set(dependency, values);
    }
  }
  const queue = stableSort([...selectedNames].filter((module) => safeCandidates.get(module).analysis.dependencies
    .some((dependency) => !activeIds.has(dependency.module) && !selectedNames.has(dependency.module))));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const module = queue[cursor];
    if (!selectedNames.has(module)) continue;
    const candidate = safeCandidates.get(module);
    const missing = candidate.analysis.dependencies
      .map((dependency) => dependency.module)
      .filter((dependency) => !activeIds.has(dependency) && !selectedNames.has(dependency));
    if (!missing.length) continue;
    selectedNames.delete(module);
    dependencyRejections.push({ module, artifact_id: candidate.artifact.id, stage: "dependency-closure", reasons: ["dependency-closure-unsatisfied"], missing_dependencies: [...new Set(missing)].sort() });
    queue.push(...stableSort(dependants.get(module) ?? []).filter((dependant) => selectedNames.has(dependant)));
  }

  const selected = stableSort([...selectedNames].map((module) => safeCandidates.get(module)), (candidate) => candidate.artifact.module);
  const finalModuleCount = inputs.activeCatalog.modules.length + selected.length;
  const readiness = {
    minimum_modules: minimumModules,
    final_module_count: finalModuleCount,
    target_met: minimumModules === null ? null : finalModuleCount >= minimumModules,
    module_gap: minimumModules === null ? null : Math.max(0, minimumModules - finalModuleCount)
  };
  const moduleRejections = stableSort([...artifactRejections, ...dependencyRejections], (item) => `${item.module ?? ""}\0${item.artifact_id}`);
  const variantReviews = stableSort(inputs.manifest.modules.map((manifestModule) => ({
    module: manifestModule.module,
    conflict_state: manifestModule.conflict_state,
    manifest_selected_artifact_id: manifestModule.selected_artifact_id,
    manifest_selected_format: manifestModule.selected_format,
    selection_policy: manifestModule.selection_policy,
    release_state: activeIds.has(manifestModule.module) ? "active-preserved" : selectedNames.has(manifestModule.module) ? "promoted" : "not-promoted",
    variants: stableSort(manifestModule.variants ?? [], (variant) => `${variant.format}\0${variant.artifact_id}`).map((variant) => ({
      artifact_id: variant.artifact_id,
      format: variant.format,
      source_id: variant.source_id,
      sha256: variant.sha256,
      parser_status: variant.parser_status,
      state: variant.format === "active" && activeIds.has(manifestModule.module)
        ? "active-preserved"
        : variant.artifact_id === manifestModule.selected_artifact_id && selectedNames.has(manifestModule.module)
          ? "promoted"
          : variant.artifact_id === manifestModule.selected_artifact_id
            ? "selected-not-promoted"
            : "non-active-alternate"
    }))
  })), (review) => review.module);
  return {
    releaseId,
    generatedAt,
    activeIds,
    selected,
    rejected: moduleRejections,
    readiness,
    selectedNames,
    variantReviews,
    preservedArtifactNoticeConflicts
  };
}

export async function writeReleaseCandidate(inputs, plan, outputRoot) {
  await mkdir(path.dirname(outputRoot), { recursive: true });
  await mkdir(outputRoot, { recursive: false });
  const outputData = path.join(outputRoot, "data");
  await mkdir(outputData, { recursive: true });
  await cp(
    path.join(inputs.inputRoot, "data", "mibs", "redistributable"),
    path.join(outputData, "mibs", "redistributable"),
    { recursive: true, force: false }
  );

  const selectedModules = [];
  const promotedObjects = [];
  const selectedSourceIds = new Set();
  const activeReservedRows = stableSort(inputs.activeObjects.objects
    .filter((object) => RESERVED_GRAMMAR_SYMBOLS.has(object.symbol))
    .map((object) => ({
      module: object.module,
      object_id: object.id,
      symbol: object.symbol,
      oid: object.oid,
      correction: "legacy-parser-reserved-grammar-keyword-pseudo-object-excluded"
    })), (object) => `${object.module}\0${object.oid}\0${object.object_id}`);
  const activeReservedCountByModule = new Map();
  for (const object of activeReservedRows) {
    activeReservedCountByModule.set(object.module, (activeReservedCountByModule.get(object.module) ?? 0) + 1);
  }
  const activeModules = inputs.activeCatalog.modules.map((module) => {
    const excludedRows = activeReservedCountByModule.get(module.id) ?? 0;
    if (excludedRows === 0) return module;
    if (module.resolved_oid_count < excludedRows) throw new Error(`reserved-symbol correction exceeds active object count: ${module.id}`);
    return { ...module, resolved_oid_count: module.resolved_oid_count - excludedRows };
  });
  const activeModuleCorrections = stableSort(activeModules
    .filter((module) => activeReservedCountByModule.has(module.id))
    .map((module) => {
      const excludedRows = activeReservedCountByModule.get(module.id);
      return {
        module: module.id,
        before_resolved_oid_count: module.resolved_oid_count + excludedRows,
        excluded_rows: excludedRows,
        after_resolved_oid_count: module.resolved_oid_count
      };
    }), (correction) => correction.module);
  let textualConventionCount = 0;
  for (const module of inputs.activeCatalog.modules) {
    textualConventionCount += countTextualConventions(await readFile(path.join(inputs.inputRoot, "data", module.raw_path), "utf8"));
  }
  const variantReviewByModule = new Map(plan.variantReviews.map((review) => [review.module, review]));
  const stagedObjectsByArtifact = new Map();
  for (const object of inputs.stagedObjects.objects) {
    const values = stagedObjectsByArtifact.get(object.source_artifact_id) ?? [];
    values.push(object);
    stagedObjectsByArtifact.set(object.source_artifact_id, values);
  }
  for (const candidate of plan.selected) {
    const { artifact, source, analysis } = candidate;
    selectedSourceIds.add(source.id);
    textualConventionCount += analysis.textual_convention_count;
    const rawRelative = path.join("mibs", "redistributable", "license-derived", source.id, "files", artifact.source_path).split(path.sep).join("/");
    const activationBasis = {
      policy: "fail-closed-license-signal-static-parser-dependency-closure",
      source_artifact_id: artifact.id,
      parser_status: analysis.parser_status,
      dependency_closure: "satisfied"
    };
    selectedModules.push({
      id: artifact.module,
      publisher: modulePublisher(source),
      source_id: source.id,
      publication_mode: "redistributable",
      raw_download: true,
      source_url: artifact.pinned_url,
      source_revision: artifact.source_revision,
      source_sha256: artifact.source_sha256,
      artifact_sha256: artifact.artifact_sha256,
      raw_path: rawRelative,
      license: {
        spdx: source.license.spdx,
        name: source.license.name,
        url: source.license.files[0].pinned_url,
        notice_required: true,
        basis: artifact.license_basis
      },
      revision: null,
      dependencies: stableSort(analysis.dependencies.map((dependency) => dependency.module)),
      declared_oid_count: analysis.declared_object_count,
      resolved_oid_count: analysis.resolved_object_count,
      textual_convention_count: analysis.textual_convention_count,
      notification_count: (stagedObjectsByArtifact.get(artifact.id) ?? []).filter((object) => object.kind === "notification" || object.kind === "notification-type").length,
      activation_basis: activationBasis,
      variant_selection: variantReviewByModule.get(artifact.module)
    });
    for (const object of stagedObjectsByArtifact.get(artifact.id) ?? []) {
      const {
        source_id: _sourceId,
        source_artifact_id: _sourceArtifactId,
        activation_state: _activationState,
        parser_method: _parserMethod,
        ...publicObject
      } = object;
      promotedObjects.push({
        ...publicObject
      });
    }
    const rawDestination = path.join(outputData, rawRelative);
    await mkdir(path.dirname(rawDestination), { recursive: true });
    await copyFile(path.join(inputs.inputRoot, "data", artifact.staged_path), rawDestination);
  }

  for (const sourceId of stableSort(selectedSourceIds)) {
    const source = inputs.intake.sources.find((item) => item.id === sourceId);
    for (const license of stableSort(source.license.files, (file) => file.source_path)) {
      const destination = path.join(outputData, "mibs", "redistributable", "license-derived", source.id, "licenses", license.source_path);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(inputs.inputRoot, "data", license.staged_path), destination);
    }
  }

  const modules = stableSort([...activeModules, ...selectedModules], (module) => module.id);
  const correctedActiveObjects = inputs.activeObjects.objects.filter((object) => !RESERVED_GRAMMAR_SYMBOLS.has(object.symbol));
  const objects = stableSort([...correctedActiveObjects, ...promotedObjects], (object) => `${object.module}\0${object.oid}\0${object.id}`);
  const objectIdCollisions = publicObjectIdCollisions(objects);
  const derivedSources = stableSort([...selectedSourceIds].map((sourceId) => {
    const source = inputs.intake.sources.find((item) => item.id === sourceId);
    return sourceCatalogRow(source, inputs.discovery.sources.find((item) => item.id === sourceId), plan.generatedAt);
  }), (source) => source.id);
  const sources = stableSort([...inputs.activeSources.sources, ...derivedSources], (source) => source.id);
  const counts = summarizeCounts(modules, sources, objects, textualConventionCount, objectIdCollisions);
  const catalog = {
    ...inputs.activeCatalog,
    data_release: plan.releaseId,
    generated_at: plan.generatedAt,
    policy: "fail-closed",
    inventory_scope: `${inputs.activeCatalog.inventory_scope} Candidate adds only license-signaled raw modules passing deterministic static parser, artifact-notice, conflict, and dependency-closure gates.`,
    counts,
    modules
  };
  const objectCatalog = { ...inputs.activeObjects, data_release: plan.releaseId, objects };
  const sourceCatalog = { ...inputs.activeSources, data_release: plan.releaseId, sources };
  const files = {
    "data/mib-catalog.json": digest(`${JSON.stringify(catalog, null, 2)}\n`),
    "data/mib-objects.json": digest(`${JSON.stringify(objectCatalog, null, 2)}\n`),
    "data/source-catalog.json": digest(`${JSON.stringify(sourceCatalog, null, 2)}\n`)
  };
  const report = {
    schema_version: 1,
    release_id: plan.releaseId,
    generated_at: plan.generatedAt,
    baseline_data_release: inputs.activeCatalog.data_release,
    activation_state: "candidate-not-active",
    policy: "fail-closed",
    counts: {
      active_modules_preserved: inputs.activeCatalog.modules.length,
      promoted_modules: selectedModules.length,
      final_modules: modules.length,
      promoted_objects: promotedObjects.length,
      final_objects: objects.length,
      textual_conventions: counts.textual_conventions,
      notifications: counts.notifications,
      stable_object_id_collisions: counts.stable_object_id_collisions,
      active_reserved_symbol_rows_excluded: activeReservedRows.length,
      rejected_artifacts: plan.rejected.length,
      blocking_preserved_artifact_notice_conflicts: plan.preservedArtifactNoticeConflicts.length
    },
    readiness: {
      ...plan.readiness,
      stable_object_ids_unique: objectIdCollisions.length === 0,
      restrictive_notice_conflicts_absent: plan.preservedArtifactNoticeConflicts.length === 0,
      activation_ready: plan.readiness.target_met !== false
        && objectIdCollisions.length === 0
        && plan.preservedArtifactNoticeConflicts.length === 0
    },
    artifact_notice_gate: {
      scanner_version: ARTIFACT_RESTRICTIVE_NOTICE_SCANNER_VERSION,
      policy: "direct restrictive, prohibitive, or confidential artifact notice overrides a repository-license signal",
      excluded_non_signals: ["copyright notice", "all rights reserved", "trademark notice"],
      evidence_canonicalization: ARTIFACT_NOTICE_EVIDENCE_CANONICALIZATION,
      blocking_preserved_artifacts: plan.preservedArtifactNoticeConflicts
    },
    selected: plan.selected.map(({ artifact, source, analysis }) => ({
      module: artifact.module,
      artifact_id: artifact.id,
      source_id: source.id,
      source_revision: artifact.source_revision,
      source_sha256: artifact.source_sha256,
      artifact_sha256: artifact.artifact_sha256,
      license_spdx: source.license.spdx,
      license_basis: artifact.license_basis,
      immutable_url: artifact.pinned_url,
      publication_mode: artifact.publication_mode,
      activation_basis: "license-signal+module-identity+static-pass+complete-resolution+clean-diagnostics+dependency-closure",
      resolved_objects: analysis.resolved_object_count
    })),
    rejected: plan.rejected,
    variant_reviews: plan.variantReviews,
    corrections: {
      active_reserved_symbol_rows_excluded: activeReservedRows,
      active_module_resolved_count_adjustments: activeModuleCorrections
    },
    object_id_collisions: objectIdCollisions,
    files
  };
  await Promise.all([
    writeFile(path.join(outputData, "mib-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`),
    writeFile(path.join(outputData, "mib-objects.json"), `${JSON.stringify(objectCatalog, null, 2)}\n`),
    writeFile(path.join(outputData, "source-catalog.json"), `${JSON.stringify(sourceCatalog, null, 2)}\n`),
    writeFile(path.join(outputData, "corpus-release-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  ]);
  return report;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(absolute));
    else result.push(absolute);
  }
  return result;
}

export async function verifyReleaseCandidate(outputRoot) {
  const failures = [];
  const data = path.join(outputRoot, "data");
  let catalog;
  let objects;
  let sources;
  let report;
  try {
    [catalog, objects, sources, report] = await Promise.all([
      readJson(path.join(data, "mib-catalog.json")),
      readJson(path.join(data, "mib-objects.json")),
      readJson(path.join(data, "source-catalog.json")),
      readJson(path.join(data, "corpus-release-report.json"))
    ]);
  } catch (error) {
    return { ok: false, failures: [`candidate document missing or invalid: ${error.message}`] };
  }
  if (catalog.policy !== "fail-closed" || report.policy !== "fail-closed") failures.push("candidate policy is not fail-closed");
  if (catalog.data_release !== objects.data_release || catalog.data_release !== sources.data_release || catalog.data_release !== report.release_id) failures.push("candidate release ids differ");
  if (catalog.modules.length !== catalog.counts.modules || objects.objects.length !== catalog.counts.resolved_objects) failures.push("candidate counts differ from rows");
  const moduleIds = new Set();
  const moduleOccurrences = new Map();
  const resolvedByModule = new Map();
  const actualArtifactNoticeConflicts = [];
  let textualConventionCount = 0;
  for (const object of objects.objects) {
    resolvedByModule.set(object.module, (resolvedByModule.get(object.module) ?? 0) + 1);
  }
  const sourceIds = new Set(sources.sources.map((source) => source.id));
  for (const module of catalog.modules) {
    moduleOccurrences.set(module.id, (moduleOccurrences.get(module.id) ?? 0) + 1);
    if (moduleIds.has(module.id)) failures.push(`duplicate module id: ${module.id}`);
    moduleIds.add(module.id);
    if (!sourceIds.has(module.source_id)) failures.push(`missing source: ${module.id}`);
    if (module.publication_mode !== "redistributable" || module.raw_download !== true) failures.push(`non-redistributable module: ${module.id}`);
    if ((resolvedByModule.get(module.id) ?? 0) !== module.resolved_oid_count) failures.push(`resolved object mismatch: ${module.id}`);
    if (!safeRelative(module.raw_path) || !module.raw_path.startsWith("mibs/redistributable/")) failures.push(`unsafe raw path: ${module.id}`);
    else {
      const raw = path.join(data, module.raw_path);
      try {
        if (await digestFile(raw) !== module.artifact_sha256) failures.push(`raw checksum mismatch: ${module.id}`);
        const rawText = await readFile(raw, "utf8");
        if (parseModuleName(rawText) !== module.id) failures.push(`raw module identity mismatch: ${module.id}`);
        textualConventionCount += countTextualConventions(rawText);
        const findings = scanArtifactRestrictiveNotices(rawText);
        if (findings.length) actualArtifactNoticeConflicts.push(preservedArtifactNoticeConflict(module, findings));
      } catch {
        failures.push(`raw file missing: ${module.id}`);
      }
    }
  }
  const promotedModuleIds = new Set(report.selected.map((selected) => selected.module));
  for (const module of catalog.modules.filter((item) => promotedModuleIds.has(item.id))) {
    for (const dependency of module.dependencies ?? []) if (!moduleIds.has(dependency)) failures.push(`dependency closure broken: ${module.id} -> ${dependency}`);
  }
  for (const object of objects.objects) {
    if ((moduleOccurrences.get(object.module) ?? 0) !== 1) failures.push(`object does not resolve to exactly one manifest module: ${object.id}`);
    if (RESERVED_GRAMMAR_SYMBOLS.has(object.symbol)) failures.push(`reserved grammar-keyword object remains: ${object.id}`);
  }
  const notificationCount = objects.objects.filter((object) => object.kind === "notification" || object.kind === "notification-type").length;
  const objectIdCollisions = publicObjectIdCollisions(objects.objects);
  const objectIdCollisionCount = objectIdCollisions.length;
  const recordedArtifactNoticeConflicts = report.artifact_notice_gate?.blocking_preserved_artifacts;
  const artifactNoticeConflictCount = actualArtifactNoticeConflicts.length;
  if (report.artifact_notice_gate?.scanner_version !== ARTIFACT_RESTRICTIVE_NOTICE_SCANNER_VERSION
    || report.artifact_notice_gate?.evidence_canonicalization !== ARTIFACT_NOTICE_EVIDENCE_CANONICALIZATION
    || !Array.isArray(recordedArtifactNoticeConflicts)
    || JSON.stringify(recordedArtifactNoticeConflicts ?? []) !== JSON.stringify(actualArtifactNoticeConflicts)
    || report.counts.blocking_preserved_artifact_notice_conflicts !== artifactNoticeConflictCount
    || report.readiness.restrictive_notice_conflicts_absent !== (artifactNoticeConflictCount === 0)) {
    failures.push("restrictive artifact-notice conflict disclosure mismatch");
  }
  if (catalog.counts.textual_conventions !== textualConventionCount) failures.push("textual-convention count mismatch");
  if (catalog.counts.notifications !== notificationCount) failures.push("notification count mismatch");
  if (catalog.counts.stable_object_id_collisions !== objectIdCollisionCount
    || report.object_id_collisions?.length !== objectIdCollisionCount
    || report.readiness.stable_object_ids_unique !== (objectIdCollisionCount === 0)
    || report.readiness.activation_ready !== (report.readiness.target_met !== false
      && objectIdCollisionCount === 0
      && artifactNoticeConflictCount === 0)) failures.push("stable object-id collision disclosure mismatch");
  if (JSON.stringify(report.object_id_collisions ?? []) !== JSON.stringify(objectIdCollisions)) failures.push("stable object-id collision details mismatch");
  const correctedRows = report.corrections?.active_reserved_symbol_rows_excluded;
  const correctedModules = report.corrections?.active_module_resolved_count_adjustments;
  if (!Array.isArray(correctedRows) || !Array.isArray(correctedModules)) {
    failures.push("active reserved-symbol correction record missing");
  } else {
    const recordedCountByModule = new Map();
    const correctedRowKeys = new Set();
    for (const correction of correctedRows) {
      const rowKey = `${correction.module}\0${correction.oid}\0${correction.object_id}`;
      if (correctedRowKeys.has(rowKey)) failures.push(`duplicate reserved-symbol correction: ${correction.object_id}`);
      correctedRowKeys.add(rowKey);
      if (!RESERVED_GRAMMAR_SYMBOLS.has(correction.symbol)
        || correction.correction !== "legacy-parser-reserved-grammar-keyword-pseudo-object-excluded") failures.push(`invalid reserved-symbol correction: ${correction.object_id}`);
      recordedCountByModule.set(correction.module, (recordedCountByModule.get(correction.module) ?? 0) + 1);
    }
    if (report.counts.active_reserved_symbol_rows_excluded !== correctedRows.length) failures.push("active reserved-symbol correction count mismatch");
    const adjustedIds = new Set();
    for (const correction of correctedModules) {
      if (adjustedIds.has(correction.module)) failures.push(`duplicate active module correction: ${correction.module}`);
      adjustedIds.add(correction.module);
      const recordedRows = recordedCountByModule.get(correction.module) ?? 0;
      const module = catalog.modules.find((item) => item.id === correction.module);
      if (recordedRows === 0
        || promotedModuleIds.has(correction.module)
        || correction.excluded_rows !== recordedRows
        || correction.before_resolved_oid_count - correction.excluded_rows !== correction.after_resolved_oid_count
        || module?.resolved_oid_count !== correction.after_resolved_oid_count) failures.push(`active module correction mismatch: ${correction.module}`);
    }
    for (const module of recordedCountByModule.keys()) if (!adjustedIds.has(module)) failures.push(`active module correction missing: ${module}`);
  }
  for (const selected of report.selected) {
    const module = catalog.modules.find((item) => item.id === selected.module);
    if (!module?.activation_basis
      || !module.variant_selection
      || module.source_revision !== selected.source_revision
      || module.source_sha256 !== selected.source_sha256
      || module.artifact_sha256 !== selected.artifact_sha256
      || module.license?.spdx !== selected.license_spdx
      || module.license?.basis !== selected.license_basis
      || module.publication_mode !== selected.publication_mode
      || module.source_url !== selected.immutable_url) failures.push(`promotion provenance missing: ${selected.module}`);
    const promoted = objects.objects.filter((object) => object.module === selected.module);
    if (promoted.length !== selected.resolved_objects) failures.push(`promoted object count mismatch: ${selected.module}`);
    const redundantKeys = ["source_id", "source_artifact_id", "activation_state", "parser_method", "provenance"];
    if (promoted.some((object) => redundantKeys.some((key) => Object.hasOwn(object, key)))) failures.push(`promoted object repeats module provenance: ${selected.module}`);
    const source = sources.sources.find((item) => item.id === selected.source_id);
    if (!source?.license || source.license.spdx !== selected.license_spdx) failures.push(`promoted source license missing: ${selected.source_id}`);
    for (const license of source?.license?.files ?? []) {
      const licensePath = path.join(data, "mibs", "redistributable", "license-derived", source.id, "licenses", license.source_path);
      try {
        if (await digestFile(licensePath) !== license.sha256) failures.push(`license checksum mismatch: ${source.id}/${license.source_path}`);
      } catch {
        failures.push(`license file missing: ${source.id}/${license.source_path}`);
      }
    }
  }
  for (const [relative, expected] of Object.entries(report.files ?? {})) {
    try {
      if (await digestFile(path.join(outputRoot, relative)) !== expected) failures.push(`document checksum mismatch: ${relative}`);
    } catch {
      failures.push(`document missing: ${relative}`);
    }
  }
  if (report.readiness.minimum_modules !== null
    && report.readiness.final_module_count < report.readiness.minimum_modules
    && report.readiness.target_met !== false) failures.push("minimum-module readiness is inconsistent");
  const listedRaw = new Set(catalog.modules.map((module) => path.resolve(data, module.raw_path)));
  try {
    for (const file of (await walk(path.join(data, "mibs", "redistributable"))).filter((item) => !item.includes(`${path.sep}licenses${path.sep}`))) {
      if (!listedRaw.has(path.resolve(file)) && parseModuleName(await readFile(file, "utf8")) !== null) failures.push(`unmanifested raw file: ${path.relative(outputRoot, file)}`);
    }
  } catch {
    failures.push("redistributable raw directory missing");
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)].sort(), counts: report.counts, readiness: report.readiness };
}

export async function buildReleaseCandidate(inputRoot, outputRoot, options) {
  const inputs = await loadReleaseInputs(inputRoot);
  const plan = await planReleaseCandidate(inputs, options);
  const report = await writeReleaseCandidate(inputs, plan, outputRoot);
  const verification = await verifyReleaseCandidate(outputRoot);
  if (!verification.ok) throw new Error(`candidate verification failed:\n${verification.failures.join("\n")}`);
  return { report, verification };
}
