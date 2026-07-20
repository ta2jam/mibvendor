import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

import {
  ARTIFACT_NOTICE_EVIDENCE_CANONICALIZATION,
  ARTIFACT_RESTRICTIVE_NOTICE_SCANNER_VERSION,
  scanArtifactRestrictiveNotices
} from "./artifact-restrictive-notices.mjs";
import {
  importBindingsFor,
  importsFor,
  moduleName,
  parseDefinitions,
  parseMacros,
  parseTextualConventions,
  resolveObjects
} from "../update-mib-catalog.mjs";
import { validateCorpusExpansionCandidates } from "../validate-corpus-expansion-candidates.mjs";
import { validateLicenseDerivedIntake } from "../validate-license-derived-intake.mjs";
import { validateRawMibAnalysis } from "../validate-raw-mib-analysis.mjs";
import { validateSourceDiscovery } from "../validate-source-discovery.mjs";

const MAX_CANDIDATES = 10_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_WORKSPACE_DATA_FILE_BYTES = 128 * 1024 * 1024;
const PARSER_METHOD = "deterministic-static-smi-no-external-execution";
const FORMAT_PRIORITY = Object.freeze({ active: 0, raw: 1 });
const GENERATED_PATHS = Object.freeze([
  "source-discovery.json",
  "license-derived-intake.json",
  "corpus-expansion-candidates.json",
  "raw-mib-analysis.json",
  "raw-mib-objects-staging.json.gz",
  "raw-mib-types-staging.json.gz",
  path.join("staging", "license-derived", "raw-mibs")
]);

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function gitBlobOid(bytes) {
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex");
}

function stableStringCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function casefold(value) {
  return value.normalize("NFD").toLowerCase();
}

function canonicalPath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\") || /[\0-\x1f\x7f]/.test(value) || path.posix.isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty POSIX relative path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} is unsafe: ${value}`);
  }
  return normalized;
}

function githubRepository(value) {
  if (typeof value !== "string" || value.length > 201) return null;
  const components = value.split("/");
  if (components.length !== 2) return null;
  const [owner, repository] = components;
  if (new Set([".", ".."]).has(owner) || new Set([".", ".."]).has(repository)) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/.test(owner)) return null;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/.test(repository) || repository.toLowerCase().endsWith(".git")) return null;
  return value;
}

function requireHttpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`${label} must be a valid HTTPS URL`);
}

function requireHttpsPinned(url, commit, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "https:" || !parsed.pathname.includes(`/${commit}/`)) {
    throw new Error(`${label} must be HTTPS and pinned to ${commit}`);
  }
}

function gitOutput(root, arguments_, options = {}) {
  const environment = Object.fromEntries([
    "HOME", "LANG", "LC_ALL", "PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR"
  ].filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  try {
    return execFileSync("git", ["-C", root, ...arguments_], {
      encoding: options.encoding ?? "utf8",
      env: {
        ...environment,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0"
      },
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const detail = error.stderr?.toString("utf8").trim();
    throw new Error(`Materialized-source Git verification failed${detail ? `: ${detail}` : ""}`);
  }
}

function repositoryFromGithubRemote(remote) {
  const https = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i.exec(remote);
  if (https) return https[1];
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i.exec(remote);
  return ssh?.[1] ?? null;
}

async function verifyMaterializedGitCheckout(root, source) {
  const [rootPath, topLevel] = await Promise.all([
    realpath(root),
    Promise.resolve(gitOutput(root, ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "rev-parse", "--show-toplevel"]).trim()).then(realpath)
  ]);
  if (rootPath !== topLevel) throw new Error("Materialized-source upstream must be the Git worktree root");

  const safeConfiguration = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];
  const head = gitOutput(root, [...safeConfiguration, "rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (head !== source.commit) throw new Error(`Materialized-source Git HEAD ${head} does not match reviewed commit ${source.commit}`);
  const origin = gitOutput(root, [...safeConfiguration, "config", "--get", "remote.origin.url"]).trim();
  if (repositoryFromGithubRemote(origin)?.toLowerCase() !== source.repository.toLowerCase()) {
    throw new Error(`Materialized-source Git origin does not match reviewed repository ${source.repository}`);
  }

  const tracked = new Map();
  const index = gitOutput(root, [...safeConfiguration, "ls-files", "--stage", "-z"], { encoding: "buffer" });
  for (const record of index.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(\d{6}) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error("Materialized-source Git index contains an unreadable entry");
    const [, mode, oid, stage, relativePath] = match;
    if (stage !== "0") throw new Error(`Materialized-source Git index has an unresolved entry: ${relativePath}`);
    if (mode === "120000") throw new Error(`Materialized-source Git symlink is forbidden: ${relativePath}`);
    if (mode === "160000") throw new Error(`Materialized-source Git submodule is forbidden: ${relativePath}`);
    if (!new Set(["100644", "100755"]).has(mode)) throw new Error(`Materialized-source Git mode ${mode} is unsupported: ${relativePath}`);
    tracked.set(relativePath, oid);
  }
  const status = gitOutput(root, [...safeConfiguration, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], { encoding: "buffer" });
  if (status.length !== 0) throw new Error("Materialized-source Git worktree must be clean and contain no untracked files");
  return { tracked, origin };
}

function pathContains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveRegularDirectory(directory, label) {
  let status;
  try {
    status = await lstat(directory);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${label} does not exist`);
    throw error;
  }
  if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`${label} must be a real directory, not a symlink`);
  return realpath(directory);
}

async function assertNoSymlinkAncestors(root, relativePath, label) {
  const safe = canonicalPath(relativePath, label);
  let current = root;
  for (const component of safe.split("/").slice(0, -1)) {
    current = path.join(current, component);
    try {
      const status = await lstat(current);
      if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`${label} traverses a symlink or non-directory: ${current}`);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

async function assertIsolatedCandidateWorkspace(workspaceData) {
  for (const relativePath of GENERATED_PATHS) {
    await assertNoSymlinkAncestors(workspaceData, relativePath, "Materialized-source adapter generated path");
    try {
      await lstat(path.join(workspaceData, relativePath));
      throw new Error(`Materialized-source adapter requires an isolated candidate workspace; existing generated path: data/${relativePath}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function validateManifest(manifest) {
  if (manifest?.schema_version !== 1) throw new Error("Materialized-source adapter manifest schema_version must be 1");
  const source = manifest.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Materialized-source adapter source is required");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(source.id ?? "")) throw new Error("Materialized-source adapter source id is unsafe");
  if (!githubRepository(source.repository)) throw new Error("Materialized-source adapter repository must be a safe owner/name");
  requireHttpsUrl(source.homepage, "Materialized-source adapter homepage");
  if (!/^[0-9a-f]{40}$/.test(source.commit ?? "")) throw new Error("Materialized-source adapter commit must be a lowercase 40-character digest");
  if (typeof source.default_branch !== "string" || source.default_branch.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(source.default_branch)
    || source.default_branch.split("/").some((component) => !component || component === "." || component === "..")) {
    throw new Error("Materialized-source adapter default_branch is unsafe");
  }
  if (!Array.isArray(source.source_roles) || !source.source_roles.includes("mib-corpus")
    || new Set(source.source_roles).size !== source.source_roles.length
    || source.source_roles.some((role) => typeof role !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(role))) {
    throw new Error("Materialized-source adapter must declare unique safe source roles including mib-corpus");
  }
  if (!Number.isSafeInteger(source.minimum_candidate_count) || source.minimum_candidate_count < 1 || source.minimum_candidate_count > MAX_CANDIDATES) {
    throw new Error(`Materialized-source adapter minimum_candidate_count must be between 1 and ${MAX_CANDIDATES}`);
  }
  if (!Array.isArray(source.candidate_roots) || source.candidate_roots.length === 0) throw new Error("Materialized-source adapter candidate_roots are required");
  const license = source.license;
  if (!license || license.status !== "license-derived-approval" || typeof license.spdx !== "string" || license.spdx === "NOASSERTION"
    || license.spdx.length > 200 || !/^[A-Za-z0-9.+() -]+$/.test(license.spdx)
    || typeof license.name !== "string" || !license.name.trim() || license.name.length > 200 || /[\0-\x1f\x7f]/.test(license.name)) {
    throw new Error("Materialized-source adapter requires a recognized repository-license signal");
  }
  canonicalPath(license.path, "Materialized-source adapter license path");
  if (!/^[0-9a-f]{64}$/.test(license.sha256 ?? "") || !/^[0-9a-f]{40}$/.test(license.git_blob_oid ?? "")) {
    throw new Error("Materialized-source adapter license requires pinned SHA-256 and Git blob digests");
  }
  const rootKeys = new Set();
  for (const root of source.candidate_roots) {
    if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("Materialized-source adapter candidate root must be an object");
    canonicalPath(root.path, "Materialized-source adapter candidate root");
    if (root.kind !== "mib-file") throw new Error(`Unsupported materialized-source adapter candidate kind: ${root.kind}`);
    if (!new Set(["all-files", "exact", "extensions", "mib-names"]).has(root.matcher)) throw new Error(`Unsupported materialized-source adapter matcher: ${root.matcher}`);
    if (new Set(["extensions", "mib-names"]).has(root.matcher)
      && (!Array.isArray(root.extensions) || root.extensions.length === 0
        || root.extensions.some((extension) => typeof extension !== "string" || !/^\.[a-z0-9]+$/i.test(extension))
        || new Set(root.extensions.map(casefold)).size !== root.extensions.length)) {
      throw new Error(`Materialized-source adapter matcher ${root.matcher} requires safe extensions`);
    }
    if (root.exclude_names !== undefined && (!Array.isArray(root.exclude_names)
      || root.exclude_names.some((name) => typeof name !== "string" || !name || name.length > 255 || name.includes("/") || name.includes("\\") || /[\0-\x1f\x7f]/.test(name))
      || new Set(root.exclude_names.map(casefold)).size !== root.exclude_names.length)) {
      throw new Error("Materialized-source adapter exclude_names must contain unique safe basenames");
    }
    const rootKey = JSON.stringify([root.path, root.kind, root.matcher, root.extensions ?? [], root.exclude_names ?? []]);
    if (rootKeys.has(rootKey)) throw new Error(`Duplicate materialized-source adapter candidate root: ${root.path}`);
    rootKeys.add(rootKey);
  }
  if (manifest.conflict_reviews !== undefined && !Array.isArray(manifest.conflict_reviews)) throw new Error("Materialized-source adapter conflict_reviews must be an array");
  const reviewModules = new Set();
  for (const review of manifest.conflict_reviews ?? []) {
    const reviewKey = casefold(review?.module ?? "");
    if (reviewModules.has(reviewKey)) throw new Error(`Duplicate materialized-source adapter conflict review: ${review.module}`);
    reviewModules.add(reviewKey);
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(review.module ?? "")) throw new Error("Materialized-source adapter conflict review module is unsafe");
    canonicalPath(review.selected_path, `Materialized-source adapter conflict review path for ${review.module}`);
    if (typeof review.evidence !== "string" || !review.evidence.trim() || review.evidence.length > 2_000) throw new Error(`Materialized-source adapter conflict review evidence is missing or too long for ${review.module}`);
  }
  return source;
}

function encodedRawUrl(repository, commit, relativePath) {
  return `https://raw.githubusercontent.com/${repository}/${commit}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

async function readBoundedRegularFile(root, relativePath, label, maximumBytes = MAX_FILE_BYTES) {
  const safe = canonicalPath(relativePath, label);
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, ...safe.split("/"));
  if (!absolute.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error(`${label} escaped its root`);
  const status = await lstat(absolute);
  if (status.isSymbolicLink() || !status.isFile()) throw new Error(`${label} must be a regular file`);
  if (status.size > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  return readFile(absolute);
}

async function readWorkspaceJson(workspaceData, relativePath, label) {
  await assertNoSymlinkAncestors(workspaceData, relativePath, label);
  const bytes = await readBoundedRegularFile(workspaceData, relativePath, label, MAX_WORKSPACE_DATA_FILE_BYTES);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function walkRegularFiles(root, relativeDirectory) {
  const safe = canonicalPath(relativeDirectory, "Materialized-source adapter candidate directory");
  const absoluteRoot = path.resolve(root);
  const start = path.resolve(absoluteRoot, ...safe.split("/"));
  if (!start.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error("Materialized-source adapter candidate directory escaped its root");
  const result = [];
  async function walk(absolute, relative) {
    const status = await lstat(absolute);
    if (status.isSymbolicLink()) throw new Error(`Materialized-source adapter refuses symlinked upstream content: ${relative}`);
    if (status.isFile()) {
      result.push(relative);
      return;
    }
    if (!status.isDirectory()) throw new Error(`Materialized-source adapter refuses special upstream content: ${relative}`);
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((left, right) => stableStringCompare(left.name, right.name))) {
      if (absolute === absoluteRoot && entry.name === ".git") continue;
      await walk(path.join(absolute, entry.name), path.posix.join(relative, entry.name));
    }
  }
  await walk(start, safe);
  return result;
}

function pathMatches(candidatePath, root) {
  const name = path.posix.basename(candidatePath);
  if ((root.exclude_names ?? []).some((excluded) => casefold(excluded) === casefold(name))) return false;
  if (root.matcher === "exact") return candidatePath === root.path;
  if (root.matcher === "all-files") return true;
  const extension = path.posix.extname(name).toLowerCase();
  if (root.matcher === "extensions") return root.extensions.map((item) => item.toLowerCase()).includes(extension);
  return root.extensions.map((item) => item.toLowerCase()).includes(extension)
    && /(?:MIB|SMI|TC)(?:\.(?:mib|txt))?$/i.test(name);
}

function candidateRootContains(candidatePath, root) {
  if (root.matcher === "exact") return candidatePath === root.path;
  return root.path === "." || candidatePath === root.path || candidatePath.startsWith(`${root.path}/`);
}

function countBy(rows, field) {
  const result = {};
  for (const row of rows) result[row[field]] = (result[row[field]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => stableStringCompare(left, right)));
}

function manifestDigest(document) {
  return sha256(JSON.stringify({ ...document, manifest_sha256: null }));
}

function stagedRelativePath(sourceId, kind, sourcePath, suffix = "") {
  const parsed = path.posix.parse(sourcePath);
  const filename = suffix ? `${parsed.name}.${suffix}${parsed.ext}` : parsed.base;
  return path.posix.join("staging", "license-derived", "raw-mibs", sourceId, kind, parsed.dir, filename);
}

function buildCandidateSet(activeCatalog, intake, generatedAt, conflictReviews) {
  const variants = [
    ...activeCatalog.modules.map((module) => ({
      module: module.id,
      format: "active",
      source_id: module.source_id,
      artifact_id: `active:${module.id}`,
      sha256: module.artifact_sha256,
      parser_status: "active-release"
    })),
    ...intake.artifacts.filter((artifact) => artifact.module !== null && artifact.retention_state === "retained").map((artifact) => ({
      module: artifact.module,
      format: "raw",
      source_id: artifact.source_id,
      artifact_id: artifact.id,
      sha256: artifact.artifact_sha256,
      parser_status: artifact.parser_status
    }))
  ];
  const byModule = new Map();
  for (const variant of variants) {
    const values = byModule.get(variant.module) ?? [];
    values.push(variant);
    byModule.set(variant.module, values);
  }
  const reviewByModule = new Map(conflictReviews.map((review) => [review.module, review]));
  const reviewedModules = new Set();
  const modules = [];
  for (const [module, moduleVariants] of byModule) {
    moduleVariants.sort((left, right) => FORMAT_PRIORITY[left.format] - FORMAT_PRIORITY[right.format]
      || stableStringCompare(left.artifact_id, right.artifact_id));
    const distinctContentCount = new Set(moduleVariants.map((variant) => variant.sha256)).size;
    const conflictState = moduleVariants.length === 1 ? "single" : distinctContentCount === 1 ? "exact-duplicate" : "content-variants";
    let selected = moduleVariants[0];
    let selectedFormat = selected.format;
    let selectionPolicy = selected.format === "active" ? "preserve-active-release" : "single-or-exact-duplicate-raw";
    if (selected.format !== "active" && conflictState === "content-variants") {
      const review = reviewByModule.get(module);
      if (!review) {
        selectedFormat = "quarantine";
        selectionPolicy = "content-variants-require-explicit-review";
      } else {
        selected = moduleVariants.find((variant) => variant.artifact_id.endsWith(`:${review.selected_path}`));
        if (!selected) throw new Error(`Conflict review selection is not a discovered variant: ${module}:${review.selected_path}`);
        selectedFormat = "raw";
        selectionPolicy = "explicit-materialized-source-conflict-review";
        reviewedModules.add(module);
      }
    }
    modules.push({
      module,
      activation_state: selected.format === "active" ? "active" : "candidate",
      selected_artifact_id: selected.artifact_id,
      selected_format: selectedFormat,
      selected_source_id: selected.source_id,
      selected_sha256: selected.sha256,
      selection_policy: selectionPolicy,
      variant_count: moduleVariants.length,
      distinct_content_count: distinctContentCount,
      conflict_state: conflictState,
      variants: moduleVariants
    });
  }
  for (const review of conflictReviews) {
    if (!reviewedModules.has(review.module)) throw new Error(`Conflict review does not target a content-variant module: ${review.module}`);
  }
  modules.sort((left, right) => stableStringCompare(left.module, right.module));
  const document = {
    schema_version: 1,
    generated_at: generatedAt,
    baseline_data_release: activeCatalog.data_release,
    activation_state: "candidate-not-active",
    target_unique_module_count: 550,
    counts: {
      active_modules: modules.filter((module) => module.activation_state === "active").length,
      candidate_modules: modules.filter((module) => module.activation_state === "candidate").length,
      unique_modules: modules.length,
      variants: variants.length,
      modules_with_variants: modules.filter((module) => module.variant_count > 1).length,
      content_variant_modules: modules.filter((module) => module.conflict_state === "content-variants").length,
      selected_formats: Object.fromEntries(["active", "compiled", "raw"].map((format) => [format, modules.filter((module) => module.selected_format === format).length]))
    },
    target_met_in_candidate_set: modules.length >= 550,
    manifest_sha256: null,
    modules
  };
  document.manifest_sha256 = manifestDigest(document);
  return document;
}

function buildRawAnalysis(candidateSet, intake, activeCatalog, activeObjects, generatedAt) {
  const artifactById = new Map(intake.artifacts.map((artifact) => [artifact.id, artifact]));
  const selectedRows = candidateSet.modules.filter((module) => module.selected_format === "raw");
  const selectedRawModules = new Set(selectedRows.map((module) => module.module));
  const activeModules = new Set(activeCatalog.modules.map((module) => module.id));
  const parsedModules = [];
  const moduleInputs = [];
  for (const row of selectedRows) {
    const artifact = artifactById.get(row.selected_artifact_id);
    if (!artifact?._bytes) throw new Error(`Selected materialized raw artifact is unavailable: ${row.selected_artifact_id}`);
    const text = artifact._bytes.toString("utf8");
    const definitions = parseDefinitions(text, row.module);
    const textualConventions = parseTextualConventions(text, row.module);
    const macros = parseMacros(text, row.module);
    const symbolCounts = new Map();
    for (const object of definitions) symbolCounts.set(object.symbol, (symbolCounts.get(object.symbol) ?? 0) + 1);
    const duplicateSymbols = [...symbolCounts].filter(([, count]) => count > 1).map(([symbol]) => symbol).sort(stableStringCompare);
    const objects = definitions.filter((object) => symbolCounts.get(object.symbol) === 1);
    parsedModules.push({ module: row.module, objects, imports: importBindingsFor(text) });
    moduleInputs.push({ row, artifact, dependencies: importsFor(text), objects, duplicateSymbols, textualConventions, macros });
  }
  const resolvedObjects = resolveObjects(parsedModules, [], { externalObjects: activeObjects.objects, useNetSnmp: false });
  const resolvedByModule = new Map();
  for (const object of resolvedObjects) {
    const rows = resolvedByModule.get(object.module) ?? [];
    rows.push(object);
    resolvedByModule.set(object.module, rows);
  }
  function dependencyRecord(dependency) {
    if (activeModules.has(dependency)) return { module: dependency, state: "active" };
    if (selectedRawModules.has(dependency)) return { module: dependency, state: "selected-raw" };
    return { module: dependency, state: "missing" };
  }
  const modules = moduleInputs.map(({ row, artifact, dependencies, objects, duplicateSymbols, textualConventions, macros }) => {
    const resolved = resolvedByModule.get(row.module) ?? [];
    const dependencyRecords = dependencies.map(dependencyRecord);
    const missingDependencies = dependencyRecords.filter((dependency) => dependency.state === "missing").length;
    const unresolvedObjects = objects.length - resolved.length;
    const semanticDefinitions = objects.length + textualConventions.length + macros.length;
    const parserStatus = semanticDefinitions === 0
      ? "static-empty"
      : unresolvedObjects === 0 && missingDependencies === 0 && duplicateSymbols.length === 0
        ? "static-pass"
        : "static-partial";
    return {
      module: row.module,
      selected_artifact_id: row.selected_artifact_id,
      source_id: artifact.source_id,
      artifact_sha256: artifact.artifact_sha256,
      parser_method: PARSER_METHOD,
      parser_status: parserStatus,
      declared_object_count: objects.length,
      resolved_object_count: resolved.length,
      unresolved_object_count: unresolvedObjects,
      textual_convention_count: textualConventions.length,
      macro_count: macros.length,
      semantic_definition_count: semanticDefinitions,
      duplicate_symbol_count: duplicateSymbols.length,
      duplicate_symbols: duplicateSymbols,
      dependency_count: dependencies.length,
      missing_dependency_count: missingDependencies,
      dependencies: dependencyRecords
    };
  }).sort((left, right) => stableStringCompare(left.module, right.module));
  const moduleByName = new Map(modules.map((module) => [module.module, module]));
  const objects = resolvedObjects.map((object) => ({
    ...object,
    source_id: moduleByName.get(object.module).source_id,
    source_artifact_id: moduleByName.get(object.module).selected_artifact_id,
    activation_state: "staged",
    parser_method: PARSER_METHOD
  }));
  const definitions = moduleInputs.flatMap(({ row, artifact, textualConventions, macros }) => [
    ...textualConventions.map((definition) => ({ ...definition, source_id: artifact.source_id, source_artifact_id: row.selected_artifact_id, activation_state: "staged", parser_method: PARSER_METHOD })),
    ...macros.map((definition) => ({ ...definition, source_id: artifact.source_id, source_artifact_id: row.selected_artifact_id, activation_state: "staged", parser_method: PARSER_METHOD }))
  ]).sort((left, right) => stableStringCompare(left.module, right.module) || stableStringCompare(left.symbol, right.symbol));
  const counts = {
    modules: modules.length,
    static_pass: modules.filter((module) => module.parser_status === "static-pass").length,
    static_partial: modules.filter((module) => module.parser_status === "static-partial").length,
    static_empty: modules.filter((module) => module.parser_status === "static-empty").length,
    declared_objects: modules.reduce((sum, module) => sum + module.declared_object_count, 0),
    resolved_objects: objects.length,
    unresolved_objects: modules.reduce((sum, module) => sum + module.unresolved_object_count, 0),
    textual_conventions: modules.reduce((sum, module) => sum + module.textual_convention_count, 0),
    macros: modules.reduce((sum, module) => sum + module.macro_count, 0),
    semantic_definitions: modules.reduce((sum, module) => sum + module.semantic_definition_count, 0),
    duplicate_symbols: modules.reduce((sum, module) => sum + module.duplicate_symbol_count, 0),
    modules_with_duplicate_symbols: modules.filter((module) => module.duplicate_symbol_count > 0).length,
    missing_dependency_edges: modules.reduce((sum, module) => sum + module.missing_dependency_count, 0),
    modules_with_missing_dependencies: modules.filter((module) => module.missing_dependency_count > 0).length
  };
  const analysis = {
    schema_version: 2,
    generated_at: generatedAt,
    activation_state: "staged-not-active",
    baseline_data_release: activeCatalog.data_release,
    parser_gate: counts.modules > 0 && counts.static_pass === counts.modules ? "passed" : "open",
    parser_security: "no-source-code-execution-no-system-mib-enrichment",
    counts,
    manifest_sha256: null,
    modules
  };
  analysis.manifest_sha256 = manifestDigest(analysis);
  return {
    analysis,
    objects: { schema_version: 1, activation_state: "staged-not-active", objects },
    types: { schema_version: 1, activation_state: "staged-not-active", definitions }
  };
}

function publicIntake(intake) {
  return {
    ...intake,
    artifacts: intake.artifacts.map(({ _bytes: _bytes, ...artifact }) => artifact)
  };
}

// This adapter consumes an already materialized, immutable upstream checkout. It
// emits the same canonical documents as the network-backed discovery/intake
// pipeline and validates those documents before replacing workspace staging.
export async function buildMaterializedMibSourceAdapter({ upstreamRoot, workspaceRoot, manifest, generatedAt }) {
  if (!Number.isFinite(Date.parse(generatedAt)) || new Date(generatedAt).toISOString() !== generatedAt) {
    throw new Error("Materialized-source adapter generatedAt must be a canonical ISO-8601 timestamp");
  }
  const source = validateManifest(manifest);
  const [upstreamPath, workspacePath] = await Promise.all([
    resolveRegularDirectory(upstreamRoot, "Materialized-source adapter upstream"),
    resolveRegularDirectory(workspaceRoot, "Materialized-source adapter workspace")
  ]);
  if (pathContains(upstreamPath, workspacePath) || pathContains(workspacePath, upstreamPath)) {
    throw new Error("Materialized-source adapter upstream and workspace must not overlap");
  }
  const workspaceData = await resolveRegularDirectory(path.join(workspacePath, "data"), "Materialized-source adapter workspace data");
  await assertIsolatedCandidateWorkspace(workspaceData);
  const [activeCatalog, activeObjects] = await Promise.all([
    readWorkspaceJson(workspaceData, "mib-catalog.json", "Materialized-source adapter active catalog"),
    readWorkspaceJson(workspaceData, "mib-objects.json", "Materialized-source adapter active objects")
  ]);
  if (activeCatalog.data_release !== activeObjects.data_release) throw new Error("Materialized-source adapter active catalog releases differ");

  const checkout = await verifyMaterializedGitCheckout(upstreamPath, source);
  const licenseBytes = await readBoundedRegularFile(upstreamPath, source.license.path, "Materialized-source adapter license");
  if (sha256(licenseBytes) !== source.license.sha256 || gitBlobOid(licenseBytes) !== source.license.git_blob_oid) {
    throw new Error("Materialized-source adapter license bytes differ from the reviewed digests");
  }
  const trackedBlobs = checkout.tracked;
  if (trackedBlobs.get(source.license.path) !== source.license.git_blob_oid) {
    throw new Error("Materialized-source adapter license is not bound to the reviewed Git index blob");
  }
  const licenseUrl = encodedRawUrl(source.repository, source.commit, source.license.path);
  requireHttpsPinned(licenseUrl, source.commit, "Materialized-source adapter license URL");

  const candidatePaths = new Set();
  for (const candidateRoot of source.candidate_roots) {
    const files = candidateRoot.matcher === "exact"
      ? [canonicalPath(candidateRoot.path, "Materialized-source adapter exact candidate")]
      : await walkRegularFiles(upstreamPath, candidateRoot.path);
    for (const candidatePath of files) {
      if (candidatePath !== source.license.path && pathMatches(candidatePath, candidateRoot)) candidatePaths.add(candidatePath);
    }
  }
  const sortedPaths = [...candidatePaths].sort(stableStringCompare);
  const expectedTrackedPaths = [...trackedBlobs.keys()]
    .filter((candidatePath) => candidatePath !== source.license.path
      && source.candidate_roots.some((root) => candidateRootContains(candidatePath, root) && pathMatches(candidatePath, root)))
    .sort(stableStringCompare);
  if (JSON.stringify(sortedPaths) !== JSON.stringify(expectedTrackedPaths)) {
    throw new Error("Materialized-source adapter candidate walk does not cover the reviewed Git index; sparse or incomplete checkout refused");
  }
  if (sortedPaths.length < source.minimum_candidate_count) throw new Error(`Materialized-source adapter discovered ${sortedPaths.length} candidates; minimum is ${source.minimum_candidate_count}`);
  if (sortedPaths.length > MAX_CANDIDATES) throw new Error(`Materialized-source adapter candidate count exceeds ${MAX_CANDIDATES}`);

  const discoveredBytes = new Map();
  let totalBytes = licenseBytes.length;
  for (const candidatePath of sortedPaths) {
    const bytes = await readBoundedRegularFile(upstreamPath, candidatePath, `Materialized-source adapter candidate ${candidatePath}`);
    const blobOid = gitBlobOid(bytes);
    if (trackedBlobs.get(candidatePath) !== blobOid) {
      throw new Error(`Materialized-source candidate is not a clean tracked Git blob: ${candidatePath}`);
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Materialized-source adapter input exceeds ${MAX_TOTAL_BYTES} bytes`);
    discoveredBytes.set(candidatePath, bytes);
  }
  const sourceDocument = {
    id: source.id,
    provider: "materialized-pinned-checkout",
    repository: source.repository,
    homepage: source.homepage,
    source_roles: source.source_roles,
    default_branch: source.default_branch,
    commit: source.commit,
    commit_url: `https://github.com/${source.repository}/commit/${source.commit}`,
    tree_complete: true,
    checkout_verification: {
      basis: "clean-git-worktree-head-and-index-blobs",
      head: source.commit,
      origin: checkout.origin,
      tracked_candidate_count: sortedPaths.length,
      symlinks_allowed: false,
      submodules_allowed: false
    },
    repository_license: {
      status: "license-derived-approval",
      spdx: source.license.spdx,
      name: source.license.name,
      recognition_basis: "pinned-ref",
      classification_path: source.license.path,
      classification_git_blob_oid: source.license.git_blob_oid,
      api_url: `https://github.com/${source.repository}/blob/${source.commit}/${source.license.path}`,
      files: [{ path: source.license.path, git_blob_oid: source.license.git_blob_oid, pinned_url: licenseUrl }],
      caveat: "Project policy treats the pinned repository SPDX license as publication permission. Embedded third-party ownership remains subject to takedown review."
    },
    minimum_candidate_count: source.minimum_candidate_count,
    candidate_count: sortedPaths.length
  };
  const candidates = sortedPaths.map((candidatePath) => {
    const bytes = discoveredBytes.get(candidatePath);
    return {
      id: `${source.id}:${candidatePath}`,
      source_id: source.id,
      repository: source.repository,
      source_type: "mib-file",
      path: candidatePath,
      git_blob_oid: gitBlobOid(bytes),
      bytes: bytes.length,
      pinned_url: encodedRawUrl(source.repository, source.commit, candidatePath),
      repository_license_spdx: source.license.spdx,
      repository_license_status: "license-derived-approval",
      rights_review: "approved-by-repository-license-signal",
      publication_mode: "redistributable",
      content_intake: "not-fetched"
    };
  });
  const discovery = {
    schema_version: 1,
    generated_at: generatedAt,
    policy: {
      default_publication_mode: "quarantine",
      default_rights_review: "required",
      repository_license_is_file_approval: true,
      license_signal_publication_approval: true,
      license_signal_requires_recognized_spdx_and_pinned_license_file: true,
      content_downloaded_during_discovery: false
    },
    counts: {
      sources: 1,
      candidates: candidates.length,
      by_source: { [source.id]: candidates.length },
      by_type: { "mib-file": candidates.length },
      publication_modes: countBy(candidates, "publication_mode"),
      rights_review: countBy(candidates, "rights_review")
    },
    sources: [sourceDocument],
    candidates
  };

  const activeModuleIds = new Set(activeCatalog.modules.map((module) => casefold(module.id)));
  const casefoldCounts = new Map();
  for (const candidate of candidates) {
    const key = stagedRelativePath(source.id, "files", candidate.path).normalize("NFD").toLowerCase();
    casefoldCounts.set(key, (casefoldCounts.get(key) ?? 0) + 1);
  }
  const stagedFiles = new Map();
  const stagedPathKeys = new Set();
  const artifacts = [];
  for (const candidate of candidates) {
    const bytes = await readBoundedRegularFile(upstreamPath, candidate.path, `Materialized-source adapter intake ${candidate.path}`);
    if (bytes.length !== candidate.bytes || gitBlobOid(bytes) !== candidate.git_blob_oid) throw new Error(`Materialized-source adapter candidate changed after discovery: ${candidate.id}`);
    const restrictiveNoticeConflicts = scanArtifactRestrictiveNotices(bytes.toString("utf8"));
    const declaredModule = moduleName(bytes.toString("utf8"));
    const defaultStagedPath = stagedRelativePath(source.id, "files", candidate.path);
    const stagedPath = casefoldCounts.get(defaultStagedPath.normalize("NFD").toLowerCase()) === 1
      ? defaultStagedPath
      : stagedRelativePath(source.id, "files", candidate.path, `case-${sha256(candidate.id).slice(0, 12)}`);
    if (restrictiveNoticeConflicts.length === 0) {
      const stagedPathKey = casefold(stagedPath);
      if (stagedPathKeys.has(stagedPathKey)) throw new Error(`Materialized-source adapter staged path collision after disambiguation: ${stagedPath}`);
      stagedPathKeys.add(stagedPathKey);
      stagedFiles.set(stagedPath, bytes);
    }
    artifacts.push({
      id: candidate.id,
      source_id: source.id,
      module: declaredModule,
      source_path: candidate.path,
      staged_path: restrictiveNoticeConflicts.length === 0 ? stagedPath : null,
      excluded_staged_path: restrictiveNoticeConflicts.length === 0 ? null : stagedPath,
      pinned_url: candidate.pinned_url,
      source_revision: source.commit,
      git_blob_oid: candidate.git_blob_oid,
      bytes: bytes.length,
      source_sha256: sha256(bytes),
      artifact_sha256: sha256(bytes),
      license_spdx: source.license.spdx,
      license_basis: "repository-license-signal",
      publication_mode: restrictiveNoticeConflicts.length === 0 ? "redistributable" : "quarantine",
      activation_state: restrictiveNoticeConflicts.length === 0 ? "staged" : "quarantined-not-retained",
      retention_state: restrictiveNoticeConflicts.length === 0 ? "retained" : "metadata-only-evidence",
      intake_validation: restrictiveNoticeConflicts.length > 0 ? "restrictive-notice-conflict" : declaredModule ? "module-declaration-only" : "module-declaration-missing",
      restrictive_notice_conflicts: restrictiveNoticeConflicts,
      parser_status: "not-run",
      active_module_collision: declaredModule ? activeModuleIds.has(casefold(declaredModule)) : null,
      _bytes: bytes
    });
  }
  artifacts.sort((left, right) => stableStringCompare(left.id, right.id));
  const moduleSpellings = new Map();
  for (const module of [
    ...activeCatalog.modules.map((row) => row.id),
    ...artifacts.filter((artifact) => artifact.module !== null && artifact.retention_state === "retained").map((artifact) => artifact.module)
  ]) {
    const key = casefold(module);
    const spellings = moduleSpellings.get(key) ?? new Set();
    spellings.add(module);
    moduleSpellings.set(key, spellings);
  }
  for (const spellings of moduleSpellings.values()) {
    if (spellings.size > 1) {
      throw new Error(`Materialized-source adapter case-insensitive module identity collision: ${[...spellings].sort(stableStringCompare).join(", ")}`);
    }
  }
  const licenseStagedPath = stagedRelativePath(source.id, "licenses", source.license.path);
  if (stagedPathKeys.has(casefold(licenseStagedPath))) throw new Error(`Materialized-source adapter staged license path collides: ${licenseStagedPath}`);
  stagedPathKeys.add(casefold(licenseStagedPath));
  stagedFiles.set(licenseStagedPath, licenseBytes);
  const retained = artifacts.filter((artifact) => artifact.retention_state === "retained");
  const quarantined = artifacts.filter((artifact) => artifact.retention_state === "metadata-only-evidence");
  const intake = {
    schema_version: 2,
    generated_at: generatedAt,
    policy: "repository-license-signal-unless-artifact-notice-conflicts",
    activation_state: "staged-not-active",
    parser_gate: "open",
    active_data_release_at_generation: activeCatalog.data_release,
    artifact_notice_gate: {
      scanner_version: ARTIFACT_RESTRICTIVE_NOTICE_SCANNER_VERSION,
      policy: "direct restrictive, prohibitive, or confidential artifact notice overrides a repository-license signal",
      excluded_non_signals: ["copyright notice", "all rights reserved", "trademark notice"],
      evidence_canonicalization: ARTIFACT_NOTICE_EVIDENCE_CANONICALIZATION
    },
    counts: {
      sources: 1,
      artifacts: artifacts.length,
      retained_artifacts: retained.length,
      restrictive_notice_quarantined: quarantined.length,
      module_declaration_missing: retained.filter((artifact) => artifact.module === null).length,
      active_module_collisions: retained.filter((artifact) => artifact.active_module_collision === true).length,
      collision_free_candidates: retained.filter((artifact) => artifact.module !== null && artifact.active_module_collision === false).length
    },
    sources: [{
      id: source.id,
      repository: source.repository,
      commit: source.commit,
      license: {
        spdx: source.license.spdx,
        name: source.license.name,
        basis: "repository-license-signal",
        files: [{ source_path: source.license.path, staged_path: licenseStagedPath, pinned_url: licenseUrl, git_blob_oid: source.license.git_blob_oid, sha256: source.license.sha256 }]
      },
      artifact_count: artifacts.length,
      retained_artifact_count: retained.length,
      quarantined_artifact_count: quarantined.length
    }],
    artifacts
  };
  const candidateSet = buildCandidateSet(activeCatalog, intake, generatedAt, manifest.conflict_reviews ?? []);
  const raw = buildRawAnalysis(candidateSet, intake, activeCatalog, activeObjects, generatedAt);
  const publicManifest = publicIntake(intake);

  const stagingRoot = path.join(workspaceData, "staging", "license-derived", "raw-mibs");
  const documents = new Map([
    ["source-discovery.json", `${JSON.stringify(discovery, null, 2)}\n`],
    ["license-derived-intake.json", `${JSON.stringify(publicManifest, null, 2)}\n`],
    ["corpus-expansion-candidates.json", `${JSON.stringify(candidateSet, null, 2)}\n`],
    ["raw-mib-analysis.json", `${JSON.stringify(raw.analysis, null, 2)}\n`],
    ["raw-mib-objects-staging.json.gz", gzipSync(Buffer.from(`${JSON.stringify(raw.objects)}\n`), { level: 9, mtime: 0 })],
    ["raw-mib-types-staging.json.gz", gzipSync(Buffer.from(`${JSON.stringify(raw.types)}\n`), { level: 9, mtime: 0 })]
  ]);
  const temporaryRoot = path.join(workspaceData, `.materialized-mib-source-adapter-${process.pid}-${randomUUID()}`);
  const temporaryData = path.join(temporaryRoot, "data");
  const temporaryStagingRoot = path.join(temporaryRoot, "data", "staging", "license-derived", "raw-mibs");
  const promotedPaths = [];
  await mkdir(temporaryRoot, { mode: 0o700 });
  try {
    for (const [relativePath, bytes] of stagedFiles) {
      const suffix = relativePath.slice("staging/license-derived/raw-mibs/".length);
      const target = path.join(temporaryStagingRoot, suffix);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    for (const [filename, bytes] of documents) {
      const target = path.join(temporaryData, filename);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }

    const validationFailures = [
      ...validateSourceDiscovery(sourceDiscoveryRegistryForMaterializedAdapter(manifest), discovery),
      ...await validateLicenseDerivedIntake(temporaryRoot, discovery, activeCatalog, publicManifest),
      ...validateCorpusExpansionCandidates(activeCatalog, publicManifest, { artifacts: [] }, candidateSet, { enforceTarget: false }),
      ...validateRawMibAnalysis(candidateSet, publicManifest, activeCatalog, { schema_version: 1, aliases: [] }, raw.analysis, raw.objects, raw.types)
    ];
    if (validationFailures.length) {
      throw new Error(`Materialized-source adapter generated invalid canonical documents:\n${validationFailures.join("\n")}`);
    }

    await verifyMaterializedGitCheckout(upstreamPath, source);
    await assertIsolatedCandidateWorkspace(workspaceData);
    const promotions = [
      [temporaryStagingRoot, stagingRoot, path.join("staging", "license-derived", "raw-mibs")],
      ...[...documents.keys()].map((filename) => [path.join(temporaryData, filename), path.join(workspaceData, filename), filename])
    ];
    for (const [temporaryPath, finalPath, relativePath] of promotions) {
      await assertNoSymlinkAncestors(workspaceData, relativePath, "Materialized-source adapter promotion path");
      try {
        await lstat(finalPath);
        throw new Error(`Materialized-source adapter promotion destination appeared concurrently: data/${relativePath}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await mkdir(path.dirname(finalPath), { recursive: true });
      await rename(temporaryPath, finalPath);
      promotedPaths.push(finalPath);
    }
  } catch (error) {
    const rollback = await Promise.allSettled(promotedPaths.reverse().map((promotedPath) => rm(promotedPath, { recursive: true, force: true })));
    const rollbackFailures = rollback.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (rollbackFailures.length) throw new AggregateError([error, ...rollbackFailures], "Materialized-source adapter promotion failed and rollback was incomplete");
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return {
    discovery,
    intake: publicManifest,
    candidateSet,
    analysis: raw.analysis,
    objects: raw.objects,
    types: raw.types,
    summary: {
      candidates: candidates.length,
      retained: retained.length,
      quarantined: quarantined.length,
      selected_raw_modules: candidateSet.modules.filter((module) => module.selected_format === "raw").length,
      conflict_quarantines: candidateSet.modules.filter((module) => module.selected_format === "quarantine").length,
      static_pass: raw.analysis.counts.static_pass,
      static_partial: raw.analysis.counts.static_partial,
      static_empty: raw.analysis.counts.static_empty
    }
  };
}

export function sourceDiscoveryRegistryForMaterializedAdapter(manifest) {
  const source = validateManifest(manifest);
  return {
    schema_version: 1,
    provider: "github",
    sources: [{
      id: source.id,
      repository: source.repository,
      homepage: source.homepage,
      source_roles: source.source_roles,
      minimum_candidate_count: source.minimum_candidate_count,
      license_files: [source.license.path],
      candidate_roots: source.candidate_roots
    }]
  };
}
