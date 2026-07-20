import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument } from "yaml";

import { canonicalJsonSha256 } from "./canonical-json.mjs";
import { classifyPinnedLicense } from "./lib/pinned-license-classifier.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const identityRoot = path.join(projectRoot, "data", "device-identities");
const DEFAULT_SOURCE_ROOT = path.join(projectRoot, ".local", "identity-sources", "librenms");
const INPUT_ROOT = "resources/definitions/os_detection";
const SOURCE_ID = "librenms-os-detection";
const SOURCE_REPOSITORY = "librenms/librenms";
const SOURCE_ORIGIN = "https://github.com/librenms/librenms.git";
const SOURCE_REVISION = "dfba713a2ffd39c2b6619cccdec016e04a06a027";
const SOURCE_DATE = "2026-07-18";
const SOURCE_TREE = "cea8a6f237abf69eb9ce419873b6e22ef1ae91db";
const DATASET_ID = "librenms-platform-prefixes-2026-07-20.1";
const MAX_FILES = 1_000;
const MAX_FILE_BYTES = 8 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const ENTERPRISE_ROOT = [1, 3, 6, 1, 4, 1];
const SHARED_AGENT_PREFIXES = new Set([
  "1.3.6.1.4.1.8072.3.2.15",
  "1.3.6.1.4.1.8072.3.2.16",
  "1.3.6.1.4.1.8072.3.2.17",
]);
const EXPECTED_MEASUREMENTS = Object.freeze({
  input_files: 806,
  files_with_discovery: 803,
  discovery_clauses: 898,
  sys_object_id_clauses: 721,
  sys_object_id_literals: 1_013,
  conditional_literals: 222,
  unconditional_literals: 791,
  quarantined_non_enterprise_literals: 6,
  quarantined_pen_root_literals: 124,
  quarantined_shared_agent_prefixes: 3,
  quarantined_multi_platform_prefixes: 3,
  published_prefixes: 655,
  platforms: 406,
  enterprises: 266,
});
const SOURCE_CONFIG = Object.freeze({
  id: SOURCE_ID,
  repository: SOURCE_REPOSITORY,
  revision: SOURCE_REVISION,
  license_classifier: {
    scope: "resources/definitions/os_detection-derived-platform-prefixes",
    expected_spdx: "GPL-3.0-or-later",
    files: [
      {
        path: "LICENSE.txt",
        git_blob_oid: "a621ae1be05c9a1a05da2a19fe5028256f55e110",
        sha256: "67c255477940ba46460c0e6774401897e99ef9e1f82fb08d6a9b7680f39dd038",
        required_markers: [
          "LibreNMS is covered by the GPLv3",
          "GNU GENERAL PUBLIC LICENSE",
          "Version 3, 29 June 2007",
        ],
      },
      {
        path: "README.md",
        git_blob_oid: "c798b821a3201918712add1e41523ad73f992e49",
        sha256: "83c5e62a686a95f178a00c2bfbd25a7cdc4a0b2880ebfda250fb72e70e0d2ae3",
        required_markers: [
          "This program is free software: you can redistribute it and/or modify",
          "either version 3 of the License, or",
          "(at your option) any later version.",
        ],
      },
    ],
  },
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobOid(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function git(sourceRoot, args, encoding = "utf8") {
  return execFileSync("git", ["-C", sourceRoot, ...args], {
    encoding,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function compareOid(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function normalizePrefix(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const raw = trimmed.replace(/^\./, "").replace(/\.$/, "");
  if (!/^\d+(?:\.\d+)*$/.test(raw)) return null;
  const tokens = raw.split(".");
  if (tokens.some((token) => token.length > 1 && token.startsWith("0"))) return null;
  const arcs = tokens.map(Number);
  if (arcs.some((arc) => !Number.isSafeInteger(arc) || arc < 0 || arc > 0xffffffff)) return null;
  return { oid: arcs.join("."), arcs };
}

function enterpriseNumber(arcs) {
  if (!ENTERPRISE_ROOT.every((arc, index) => arcs[index] === arc)) return null;
  return arcs.length > ENTERPRISE_ROOT.length ? arcs[ENTERPRISE_ROOT.length] : null;
}

function assertStaticYamlNode(node, sourcePath) {
  if (node === null || node === undefined) return;
  if (isAlias(node)) throw new Error(`${sourcePath}: YAML aliases are not allowed`);
  if (node.tag) throw new Error(`${sourcePath}: explicit YAML tags are not allowed`);
  if (isPair(node)) {
    assertStaticYamlNode(node.key, sourcePath);
    assertStaticYamlNode(node.value, sourcePath);
    return;
  }
  if (isMap(node) || isSeq(node)) {
    for (const item of node.items) assertStaticYamlNode(item, sourcePath);
    return;
  }
  if (!isScalar(node)) throw new Error(`${sourcePath}: unsupported YAML node`);
}

export function parseStaticYaml(bytes, sourcePath) {
  const document = parseDocument(bytes.toString("utf8"), {
    maxAliasCount: 0,
    prettyErrors: false,
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    version: "1.2",
  });
  if (document.errors.length) throw new Error(`${sourcePath}: ${document.errors.map((error) => error.message).join("; ")}`);
  assertStaticYamlNode(document.contents, sourcePath);
  return document.toJS({ maxAliasCount: 0, mapAsMap: false });
}

function safePlatform(value, sourcePath) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value)) {
    throw new Error(`${sourcePath}: invalid platform identifier`);
  }
  return value;
}

function literalValues(value, sourcePath) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  throw new Error(`${sourcePath}: sysObjectID must be a string or string array`);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutField(document, field) {
  return Object.fromEntries(Object.entries(document).filter(([key]) => key !== field));
}

async function inspectSource(sourceRoot) {
  const resolvedRoot = path.resolve(sourceRoot);
  if (git(resolvedRoot, ["rev-parse", "HEAD"]).trim() !== SOURCE_REVISION) throw new Error("LibreNMS source commit drifted");
  if (git(resolvedRoot, ["remote", "get-url", "origin"]).trim() !== SOURCE_ORIGIN) throw new Error("LibreNMS source origin drifted");
  if (git(resolvedRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).trim()) throw new Error("LibreNMS source worktree is not clean");
  if (git(resolvedRoot, ["rev-parse", `${SOURCE_REVISION}:${INPUT_ROOT}`]).trim() !== SOURCE_TREE) throw new Error("LibreNMS os_detection tree drifted");
  const commitTimestamp = git(resolvedRoot, ["show", "-s", "--format=%aI", SOURCE_REVISION]).trim();
  if (commitTimestamp.slice(0, 10) !== SOURCE_DATE) throw new Error("LibreNMS source date drifted");

  const stageRows = git(resolvedRoot, ["ls-files", "--stage", "--", INPUT_ROOT]).trim().split("\n").filter(Boolean);
  if (stageRows.length === 0 || stageRows.length > MAX_FILES) throw new Error("LibreNMS input file count is outside the build bound");
  const inputs = [];
  const parsedFiles = [];
  let totalBytes = 0;
  for (const row of stageRows) {
    const match = row.match(/^(\d{6}) ([0-9a-f]{40}) 0\t(.+)$/);
    if (!match) throw new Error(`Unexpected Git index row: ${row}`);
    const [, mode, expectedBlob, sourcePath] = match;
    if (!new Set(["100644", "100755"]).has(mode)) throw new Error(`${sourcePath}: symlinks and submodules are not allowed`);
    if (!sourcePath.endsWith(".yaml")) throw new Error(`${sourcePath}: only YAML files are allowed`);
    const absolutePath = path.join(resolvedRoot, ...sourcePath.split("/"));
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${sourcePath}: input is not a regular file`);
    const bytes = await readFile(absolutePath);
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${sourcePath}: input exceeds ${MAX_FILE_BYTES} bytes`);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`LibreNMS inputs exceed ${MAX_TOTAL_BYTES} bytes`);
    if (gitBlobOid(bytes) !== expectedBlob) throw new Error(`${sourcePath}: worktree bytes do not match the pinned Git blob`);
    const input = { path: sourcePath, mode, git_blob_oid: expectedBlob, sha256: sha256(bytes), bytes: bytes.length };
    inputs.push(input);
    parsedFiles.push({ input, document: parseStaticYaml(bytes, sourcePath) });
  }
  inputs.sort((left, right) => left.path.localeCompare(right.path));
  parsedFiles.sort((left, right) => left.input.path.localeCompare(right.input.path));

  const licenseBytes = new Map();
  for (const file of SOURCE_CONFIG.license_classifier.files) {
    const bytes = await readFile(path.join(resolvedRoot, file.path));
    if (gitBlobOid(bytes) !== git(resolvedRoot, ["rev-parse", `${SOURCE_REVISION}:${file.path}`]).trim()) {
      throw new Error(`${file.path}: license worktree bytes drifted`);
    }
    licenseBytes.set(file.path, bytes);
  }
  const license = classifyPinnedLicense(SOURCE_CONFIG, licenseBytes);
  if (license.status !== "approved") throw new Error(`LibreNMS license classification failed: ${license.failures.join(", ")}`);
  return { inputs, parsedFiles, totalBytes, license };
}

export function deriveProjectPrefixes(
  { inputs, parsedFiles, totalBytes, license },
  { expectedMeasurements = EXPECTED_MEASUREMENTS } = {},
) {
  const literalRows = [];
  const measurements = {
    input_files: inputs.length,
    files_with_discovery: 0,
    discovery_clauses: 0,
    sys_object_id_clauses: 0,
    sys_object_id_literals: 0,
    conditional_literals: 0,
    unconditional_literals: 0,
    quarantined_non_enterprise_literals: 0,
    quarantined_pen_root_literals: 0,
    quarantined_shared_agent_prefixes: 0,
    quarantined_multi_platform_prefixes: 0,
    published_prefixes: 0,
    platforms: 0,
    enterprises: 0,
  };

  for (const { input, document } of parsedFiles) {
    const platform = safePlatform(document?.os, input.path);
    const discovery = document?.discovery;
    if (discovery === undefined) continue;
    if (!Array.isArray(discovery)) throw new Error(`${input.path}: discovery must be an array`);
    measurements.files_with_discovery += 1;
    measurements.discovery_clauses += discovery.length;
    for (let clauseIndex = 0; clauseIndex < discovery.length; clauseIndex += 1) {
      const clause = discovery[clauseIndex];
      if (!clause || typeof clause !== "object" || Array.isArray(clause)) throw new Error(`${input.path}: discovery clause must be a mapping`);
      if (!Object.hasOwn(clause, "sysObjectID")) continue;
      measurements.sys_object_id_clauses += 1;
      const values = literalValues(clause.sysObjectID, input.path);
      const conditional = Object.keys(clause).length !== 1 || Object.keys(clause)[0] !== "sysObjectID";
      for (let literalIndex = 0; literalIndex < values.length; literalIndex += 1) {
        const normalized = normalizePrefix(values[literalIndex]);
        literalRows.push({
          platform,
          source_path: input.path,
          git_blob_oid: input.git_blob_oid,
          source_sha256: input.sha256,
          clause_index: clauseIndex,
          literal_index: literalIndex,
          conditional,
          normalized,
        });
      }
    }
  }
  measurements.sys_object_id_literals = literalRows.length;

  const platformsByPrefix = new Map();
  for (const row of literalRows) {
    if (!row.normalized) continue;
    const platforms = platformsByPrefix.get(row.normalized.oid) ?? new Set();
    platforms.add(row.platform);
    platformsByPrefix.set(row.normalized.oid, platforms);
  }

  const prefixes = [];
  const quarantine = [];
  for (const row of literalRows) {
    const base = {
      source_path: row.source_path,
      git_blob_oid: row.git_blob_oid,
      source_sha256: row.source_sha256,
      clause_index: row.clause_index,
      literal_index: row.literal_index,
      normalized_oid: row.normalized?.oid ?? null,
      platform: row.platform,
    };
    if (row.conditional) {
      measurements.conditional_literals += 1;
      quarantine.push({ ...base, reason: "conditional-clause" });
      continue;
    }
    measurements.unconditional_literals += 1;
    if (!row.normalized || !ENTERPRISE_ROOT.every((arc, index) => row.normalized.arcs[index] === arc)) {
      measurements.quarantined_non_enterprise_literals += 1;
      quarantine.push({ ...base, reason: "outside-enterprise-tree" });
      continue;
    }
    const pen = enterpriseNumber(row.normalized.arcs);
    if (!Number.isSafeInteger(pen) || pen < 1 || row.normalized.arcs.length === ENTERPRISE_ROOT.length + 1) {
      measurements.quarantined_pen_root_literals += 1;
      quarantine.push({ ...base, reason: "pen-root-only" });
      continue;
    }
    if (SHARED_AGENT_PREFIXES.has(row.normalized.oid)) {
      measurements.quarantined_shared_agent_prefixes += 1;
      quarantine.push({ ...base, reason: "shared-net-snmp-agent" });
      continue;
    }
    if ((platformsByPrefix.get(row.normalized.oid)?.size ?? 0) > 1) {
      measurements.quarantined_multi_platform_prefixes += 1;
      quarantine.push({ ...base, reason: "multi-platform-prefix" });
      continue;
    }
    prefixes.push({
      oid_prefix: row.normalized.oid,
      enterprise_number: pen,
      platform: row.platform,
      match_method: "prefix",
      claim_strength: "platform",
      confidence: "medium",
      claim_scope: "open-source-project-platform-prefix",
      source_id: SOURCE_ID,
      source_path: row.source_path,
      git_blob_oid: row.git_blob_oid,
      source_sha256: row.source_sha256,
    });
  }

  prefixes.sort((left, right) => compareOid(left.oid_prefix, right.oid_prefix) || left.platform.localeCompare(right.platform));
  quarantine.sort((left, right) => left.source_path.localeCompare(right.source_path)
    || left.clause_index - right.clause_index || left.literal_index - right.literal_index || left.reason.localeCompare(right.reason));
  const prefixKeys = new Set(prefixes.map((prefix) => prefix.oid_prefix));
  if (prefixKeys.size !== prefixes.length) throw new Error("Published LibreNMS prefixes are not unique");
  measurements.published_prefixes = prefixes.length;
  measurements.platforms = new Set(prefixes.map((prefix) => prefix.platform)).size;
  measurements.enterprises = new Set(prefixes.map((prefix) => prefix.enterprise_number)).size;
  if (!sameJson(measurements, expectedMeasurements)) {
    throw new Error(`LibreNMS prefix measurements drifted: ${JSON.stringify(measurements)}`);
  }

  const manifest = {
    schema_version: 1,
    dataset_id: DATASET_ID,
    source: {
      id: SOURCE_ID,
      repository: SOURCE_REPOSITORY,
      revision: SOURCE_REVISION,
      source_date: SOURCE_DATE,
      commit_url: `https://github.com/${SOURCE_REPOSITORY}/commit/${SOURCE_REVISION}`,
      input_root: INPUT_ROOT,
      input_tree_git_oid: SOURCE_TREE,
      parser: "librenms-os-detection-yaml-v1",
      license_scope: SOURCE_CONFIG.license_classifier.scope,
      license,
    },
    policy: {
      source_clause_semantics: "all-clause-conditions-must-match",
      accepted_clause_keys: ["sysObjectID"],
      match_method: "arc-bound-longest-prefix",
      claim_strength: "platform",
      exact_identity_precedence: true,
      model_or_family_claims: false,
      raw_yaml_retained: false,
      source_descriptions_retained: false,
      copied_vendor_mib_content_retained: false,
      excluded_shared_agent_prefixes: [...SHARED_AGENT_PREFIXES].sort(compareOid),
      conflicts: "quarantine-prefix-seen-under-multiple-platforms-in-any-clause",
    },
    limits: { max_files: MAX_FILES, max_file_bytes: MAX_FILE_BYTES, max_total_bytes: MAX_TOTAL_BYTES },
    inputs,
    measurements,
    input_total_bytes: totalBytes,
    manifest_sha256: null,
  };
  manifest.manifest_sha256 = canonicalJsonSha256(withoutField(manifest, "manifest_sha256"));

  const quarantineReasonCounts = Object.fromEntries([...new Set(quarantine.map((row) => row.reason))].sort()
    .map((reason) => [reason, quarantine.filter((row) => row.reason === reason).length]));
  const dataset = {
    schema_version: 1,
    dataset_id: DATASET_ID,
    generated_at: null,
    layer: "open-source-project-platform-prefixes",
    publication_mode: "definition-only",
    raw_distribution: "not-provided",
    dataset_license: {
      spdx: "GPL-3.0-or-later",
      license_path: "data/device-identities/licenses/librenms/LICENSE.txt",
      notice_path: "data/device-identities/licenses/librenms/README.md",
      source_offer_url: `https://github.com/${SOURCE_REPOSITORY}/tree/${SOURCE_REVISION}/${INPUT_ROOT}`,
    },
    source_manifest_sha256: manifest.manifest_sha256,
    dataset_sha256: null,
    counts: {
      prefixes: prefixes.length,
      platforms: measurements.platforms,
      enterprises: measurements.enterprises,
      quarantined_literals: quarantine.length,
      quarantine_reasons: quarantineReasonCounts,
    },
    sources: [{
      id: SOURCE_ID,
      repository: SOURCE_REPOSITORY,
      revision: SOURCE_REVISION,
      source_date: SOURCE_DATE,
      input_root: INPUT_ROOT,
      input_tree_git_oid: SOURCE_TREE,
      repository_license_signal: license.spdx,
      license_classifier: license.classifier,
      license_scope: SOURCE_CONFIG.license_classifier.scope,
      source_url: `https://github.com/${SOURCE_REPOSITORY}/tree/${SOURCE_REVISION}/${INPUT_ROOT}`,
    }],
    prefixes,
    quarantine,
  };
  dataset.dataset_sha256 = canonicalJsonSha256(withoutField(dataset, "dataset_sha256"));
  return { manifest, dataset };
}

export async function buildProjectIdentityPrefixes(sourceRoot = DEFAULT_SOURCE_ROOT) {
  return deriveProjectPrefixes(await inspectSource(sourceRoot));
}

export async function writeProjectIdentityPrefixes({ sourceRoot = DEFAULT_SOURCE_ROOT, outputDirectory = identityRoot } = {}) {
  const artifacts = await buildProjectIdentityPrefixes(sourceRoot);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "project-prefixes-manifest.json"), `${JSON.stringify(artifacts.manifest, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, "project-prefixes.json"), `${JSON.stringify(artifacts.dataset, null, 2)}\n`);
  return artifacts;
}

function argumentsFromCommandLine(values) {
  let sourceRoot = DEFAULT_SOURCE_ROOT;
  let outputDirectory = identityRoot;
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!value || !new Set(["--source-root", "--output-dir"]).has(flag)) {
      throw new Error("Usage: node scripts/update-project-identity-prefixes.mjs [--source-root PATH] [--output-dir PATH]");
    }
    if (flag === "--source-root") sourceRoot = path.resolve(value);
    else outputDirectory = path.resolve(value);
  }
  return { sourceRoot, outputDirectory };
}

async function main() {
  const artifacts = await writeProjectIdentityPrefixes(argumentsFromCommandLine(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    dataset_id: artifacts.dataset.dataset_id,
    dataset_sha256: artifacts.dataset.dataset_sha256,
    prefixes: artifacts.dataset.counts.prefixes,
    platforms: artifacts.dataset.counts.platforms,
    enterprises: artifacts.dataset.counts.enterprises,
    quarantined_literals: artifacts.dataset.counts.quarantined_literals,
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
