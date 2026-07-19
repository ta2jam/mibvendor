import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const discovery = JSON.parse(await readFile(path.join(root, "data", "source-discovery.json"), "utf8"));
const activeCatalog = JSON.parse(await readFile(path.join(root, "data", "mib-catalog.json"), "utf8"));
const outputRoot = path.join(root, "data", "staging", "license-derived", "compiled-mibs");
const manifestPath = path.join(root, "data", "compiled-mib-intake.json");
const objectsPath = path.join(root, "data", "compiled-mib-objects-staging.json");

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest("hex");
}

function gitBlobOid(bytes) {
  return digest("sha1", Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "mibvendor-compiled-mib-intake/1 (+https://mibvendor.io)" },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function safeRelative(candidatePath) {
  if (!candidatePath || path.isAbsolute(candidatePath) || candidatePath.split("/").includes("..")) {
    throw new Error(`Unsafe intake path: ${candidatePath}`);
  }
  return candidatePath;
}

function staticParseCompiledModule(text, filenameModule) {
  const exportModule = text.match(/mibBuilder\.exportSymbols\(\s*["']([^"']+)["']/)?.[1] ?? null;
  const dependencies = [...new Set([...text.matchAll(/mibBuilder\.importSymbols\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1]))].sort();
  const objectPattern = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(MibScalar|MibTable|MibTableRow|MibTableColumn|NotificationType|MibIdentifier|ObjectIdentity|ModuleIdentity)\s*\(\s*(\(\s*\d+(?:\s*,\s*\d+)*\s*,?\s*\)(?:\s*\+\s*\(\s*\d+(?:\s*,\s*\d+)*\s*,?\s*\))*)/gm;
  const matches = [...text.matchAll(objectPattern)];
  const kindByConstructor = {
    MibScalar: "object-type",
    MibTable: "table",
    MibTableRow: "table-row",
    MibTableColumn: "table-column",
    NotificationType: "notification-type",
    MibIdentifier: "object-identifier",
    ObjectIdentity: "object-identity",
    ModuleIdentity: "module-identity"
  };
  const module = exportModule ?? filenameModule;
  const objects = matches.map((match, index) => {
    const block = text.slice(match.index, matches[index + 1]?.index ?? text.length);
    // PySNMP emits some notification OIDs as `(base) + (suffix)`. Only
    // numeric tuple concatenation is accepted; source code is never run.
    const arcs = [...match[3].matchAll(/\d+/g)].map((arc) => Number(arc[0]));
    return {
      id: `${module.toLowerCase()}--${match[1].toLowerCase()}`,
      module,
      symbol: match[1],
      oid: arcs.join("."),
      kind: kindByConstructor[match[2]],
      access: block.match(/\.setMaxAccess\(\s*["']([^"']+)["']\s*\)/)?.[1] ?? null,
      description_present: /\.setDescription\(/.test(block),
      source_format: "pysnmp-compiled-python",
      parser_method: "static-regex-no-execution"
    };
  });
  const warnings = [];
  if (!exportModule) warnings.push("missing-export-module");
  if (exportModule && exportModule !== filenameModule) warnings.push("filename-export-module-mismatch");
  if (objects.length === 0) warnings.push("no-static-oid-objects");
  return { module, dependencies, objects, warnings };
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const sourceById = new Map(discovery.sources.map((source) => [source.id, source]));
const activeModuleIds = new Set(activeCatalog.modules.map((module) => module.id));
const candidates = discovery.candidates.filter((candidate) => candidate.source_type === "compiled-mib-module"
  && candidate.publication_mode === "redistributable"
  && candidate.rights_review === "approved-by-repository-license-signal");

const parsed = await mapLimit(candidates, 8, async (candidate) => {
  const source = sourceById.get(candidate.source_id);
  if (!source || source.repository_license.status !== "license-derived-approval") {
    throw new Error(`Candidate has no license-derived source approval: ${candidate.id}`);
  }
  const bytes = await fetchBytes(candidate.pinned_url);
  if (gitBlobOid(bytes) !== candidate.git_blob_oid) throw new Error(`Git blob mismatch for ${candidate.id}`);
  const relativeSourcePath = safeRelative(candidate.path);
  const relativeOutputPath = path.join(candidate.source_id, "files", relativeSourcePath);
  const absoluteOutputPath = path.join(outputRoot, relativeOutputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, bytes);
  const filenameModule = path.basename(candidate.path, path.extname(candidate.path));
  const analysis = staticParseCompiledModule(bytes.toString("utf8"), filenameModule);
  return {
    artifact: {
      id: candidate.id,
      source_id: candidate.source_id,
      module: analysis.module,
      source_path: candidate.path,
      staged_path: path.relative(path.join(root, "data"), absoluteOutputPath),
      pinned_url: candidate.pinned_url,
      source_revision: source.commit,
      git_blob_oid: candidate.git_blob_oid,
      bytes: bytes.length,
      source_sha256: digest("sha256", bytes),
      artifact_sha256: digest("sha256", bytes),
      license_spdx: source.repository_license.spdx,
      license_basis: "repository-license-signal",
      publication_mode: "redistributable",
      activation_state: "staged",
      parser_status: analysis.warnings.length === 0 ? "static-pass" : "static-pass-with-warnings",
      parser_method: "static-regex-no-execution",
      parser_warnings: analysis.warnings,
      dependency_count: analysis.dependencies.length,
      dependencies: analysis.dependencies,
      object_count: analysis.objects.length,
      active_module_collision: activeModuleIds.has(analysis.module)
    },
    objects: analysis.objects.map((object) => ({ ...object, source_id: candidate.source_id, source_artifact_id: candidate.id }))
  };
});

const artifacts = parsed.map((item) => item.artifact).sort((left, right) => left.id.localeCompare(right.id));
const objects = parsed.flatMap((item) => item.objects)
  .sort((left, right) => left.oid.localeCompare(right.oid, "en", { numeric: true }) || left.id.localeCompare(right.id));
const sourceIds = [...new Set(artifacts.map((artifact) => artifact.source_id))].sort();
const sources = [];
for (const sourceId of sourceIds) {
  const source = sourceById.get(sourceId);
  const licenseFiles = [];
  for (const licenseFile of source.repository_license.files) {
    const bytes = await fetchBytes(licenseFile.pinned_url);
    if (gitBlobOid(bytes) !== licenseFile.git_blob_oid) throw new Error(`License Git blob mismatch for ${sourceId}:${licenseFile.path}`);
    const relativeOutputPath = path.join(sourceId, "licenses", safeRelative(licenseFile.path));
    const absoluteOutputPath = path.join(outputRoot, relativeOutputPath);
    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, bytes);
    licenseFiles.push({
      source_path: licenseFile.path,
      staged_path: path.relative(path.join(root, "data"), absoluteOutputPath),
      pinned_url: licenseFile.pinned_url,
      git_blob_oid: licenseFile.git_blob_oid,
      sha256: digest("sha256", bytes)
    });
  }
  sources.push({
    id: source.id,
    repository: source.repository,
    commit: source.commit,
    license: { spdx: source.repository_license.spdx, name: source.repository_license.name, basis: "repository-license-signal", files: licenseFiles },
    artifact_count: artifacts.filter((artifact) => artifact.source_id === source.id).length
  });
}

const manifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  policy: "repository-license-signal-is-publication-permission",
  activation_state: "staged-not-active",
  active_data_release_at_generation: activeCatalog.data_release,
  parser_security: "static-analysis-only-no-python-execution",
  counts: {
    sources: sources.length,
    artifacts: artifacts.length,
    objects: objects.length,
    parser_warning_artifacts: artifacts.filter((artifact) => artifact.parser_warnings.length > 0).length,
    active_module_collisions: artifacts.filter((artifact) => artifact.active_module_collision).length,
    collision_free_modules: artifacts.filter((artifact) => !artifact.active_module_collision).length
  },
  sources,
  artifacts
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(objectsPath, `${JSON.stringify({ schema_version: 1, activation_state: "staged-not-active", objects }, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest.counts));
