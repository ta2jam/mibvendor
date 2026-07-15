import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[item[key]] = (counts[item[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function validateSourceDiscovery(registry, document) {
  const failures = [];
  if (registry.schema_version !== 1 || document.schema_version !== 1) failures.push("Source discovery schema version must be 1");
  if (!Number.isFinite(Date.parse(document.generated_at))) failures.push("Source discovery generated_at is invalid");
  if (document.policy?.default_publication_mode !== "quarantine") failures.push("Discovery must default to quarantine");
  if (document.policy?.default_rights_review !== "required") failures.push("Discovery must require rights review");
  if (document.policy?.repository_license_is_file_approval !== false) failures.push("Repository license cannot approve candidate files");
  if (document.policy?.content_downloaded_during_discovery !== false) failures.push("Discovery cannot download source content");

  const registryIds = registry.sources.map((source) => source.id);
  const registrySources = new Map(registry.sources.map((source) => [source.id, source]));
  const sourceIds = document.sources.map((source) => source.id);
  if (new Set(registryIds).size !== registryIds.length) failures.push("Source registry ids must be unique");
  if (new Set(sourceIds).size !== sourceIds.length) failures.push("Discovered source ids must be unique");
  if (JSON.stringify([...registryIds].sort()) !== JSON.stringify([...sourceIds].sort())) failures.push("Discovered sources differ from registry");

  const sources = new Map(document.sources.map((source) => [source.id, source]));
  for (const source of document.sources) {
    if (!/^[0-9a-f]{40}$/i.test(source.commit)) failures.push(`Source ${source.id} is not pinned to a commit`);
    if (source.tree_complete !== true) failures.push(`Source ${source.id} has an incomplete tree`);
    if (source.repository_license?.status !== "signal-only") failures.push(`Source ${source.id} repository license was over-promoted`);
    const minimum = registrySources.get(source.id)?.minimum_candidate_count;
    if (!Number.isSafeInteger(minimum) || minimum < 1 || source.minimum_candidate_count !== minimum) failures.push(`Source ${source.id} minimum candidate boundary drifted`);
    if (source.candidate_count < minimum) failures.push(`Source ${source.id} candidate inventory is below its reviewed minimum`);
    if (!Array.isArray(source.repository_license?.files)) failures.push(`Source ${source.id} has an invalid license signal list`);
    if (source.repository_license?.files?.length === 0 && source.repository_license?.spdx !== "NOASSERTION") {
      failures.push(`Source ${source.id} has no license file but claims an SPDX license`);
    }
    for (const licenseFile of source.repository_license?.files ?? []) {
      if (!licenseFile.pinned_url.includes(`/${source.commit}/`)) failures.push(`Source ${source.id} license URL is not pinned`);
    }
  }

  const candidateIds = new Set();
  const sourcePathKeys = new Set();
  for (const candidate of document.candidates) {
    if (candidateIds.has(candidate.id)) failures.push(`Duplicate candidate id ${candidate.id}`);
    candidateIds.add(candidate.id);
    const sourcePathKey = `${candidate.source_id}:${candidate.path}`;
    if (sourcePathKeys.has(sourcePathKey)) failures.push(`Duplicate source path ${sourcePathKey}`);
    sourcePathKeys.add(sourcePathKey);
    const source = sources.get(candidate.source_id);
    if (!source) failures.push(`Unknown source ${candidate.source_id}`);
    if (!candidate.path || path.isAbsolute(candidate.path) || candidate.path.split("/").includes("..")) failures.push(`Unsafe candidate path ${candidate.id}`);
    if (!/^[0-9a-f]{40,64}$/i.test(candidate.git_blob_oid)) failures.push(`Invalid Git blob oid ${candidate.id}`);
    if (candidate.bytes !== null && (!Number.isSafeInteger(candidate.bytes) || candidate.bytes < 0)) failures.push(`Invalid byte count ${candidate.id}`);
    if (source && !candidate.pinned_url.includes(`/${source.commit}/`)) failures.push(`Candidate URL is not pinned ${candidate.id}`);
    if (candidate.repository_license_status !== "signal-only") failures.push(`Candidate repository license was over-promoted ${candidate.id}`);
    if (candidate.rights_review !== "required") failures.push(`Candidate bypassed rights review ${candidate.id}`);
    if (candidate.publication_mode !== "quarantine") failures.push(`Candidate escaped quarantine ${candidate.id}`);
    if (candidate.content_intake !== "not-fetched") failures.push(`Discovery fetched content ${candidate.id}`);
  }

  const bySource = countBy(document.candidates, "source_id");
  const byType = countBy(document.candidates, "source_type");
  if (document.counts?.sources !== document.sources.length) failures.push("Source count drift");
  if (document.counts?.candidates !== document.candidates.length) failures.push("Candidate count drift");
  if (JSON.stringify(document.counts?.by_source) !== JSON.stringify(bySource)) failures.push("Per-source count drift");
  if (JSON.stringify(document.counts?.by_type) !== JSON.stringify(byType)) failures.push("Per-type count drift");
  if (document.counts?.publication_modes?.quarantine !== document.candidates.length) failures.push("Quarantine count drift");
  if (document.counts?.rights_review?.required !== document.candidates.length) failures.push("Rights-review count drift");
  for (const source of document.sources) {
    if (source.candidate_count !== (bySource[source.id] ?? 0)) failures.push(`Candidate count drift for ${source.id}`);
  }

  const serialized = JSON.stringify(document);
  if (/gh[opusr]_[A-Za-z0-9_]{20,}/.test(serialized) || /authorization/i.test(serialized)) failures.push("Discovery snapshot contains a credential marker");
  return failures;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const registry = JSON.parse(await readFile(path.join(root, "data", "source-discovery-registry.json"), "utf8"));
  const document = JSON.parse(await readFile(path.join(root, "data", "source-discovery.json"), "utf8"));
  const failures = validateSourceDiscovery(registry, document);
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  } else {
    console.log(`Source discovery passed: ${document.counts.sources} sources, ${document.counts.candidates} quarantined candidates.`);
  }
}
