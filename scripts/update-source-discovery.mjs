import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const registryPath = path.join(root, "data", "source-discovery-registry.json");
const outputPath = path.join(root, "data", "source-discovery.json");
const registry = JSON.parse(await readFile(registryPath, "utf8"));

const token = process.env.GITHUB_TOKEN?.trim();
const headers = {
  accept: "application/vnd.github+json",
  "user-agent": "mibvendor-source-discovery/1",
  "x-github-api-version": "2022-11-28",
  ...(token ? { authorization: `Bearer ${token}` } : {})
};

async function github(relativeUrl, { optional = false } = {}) {
  const response = await fetch(`https://api.github.com/${relativeUrl}`, { headers });
  if (optional && response.status === 404) return null;
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new Error(`GitHub ${relativeUrl} failed with HTTP ${response.status}; rate-limit remaining=${remaining ?? "unknown"}`);
  }
  return response.json();
}

function pathMatches(candidatePath, candidateRoot) {
  const rootPath = candidateRoot.path;
  const insideRoot = rootPath === "" || candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
  if (!insideRoot) return false;
  const name = candidatePath.split("/").at(-1);
  if (candidateRoot.exclude_names?.includes(name)) return false;
  if (candidateRoot.matcher === "exact") return candidatePath === rootPath;
  if (candidateRoot.matcher === "all-files") return true;
  const extension = path.extname(name).toLowerCase();
  if (candidateRoot.matcher === "extensions") return candidateRoot.extensions.includes(extension);
  if (candidateRoot.matcher === "mib-names") {
    return candidateRoot.extensions.includes(extension)
      && /(?:MIB|SMI|TC)(?:\.(?:mib|txt))?$/i.test(name);
  }
  throw new Error(`Unsupported matcher ${candidateRoot.matcher}`);
}

function pinnedRawUrl(repository, commit, candidatePath) {
  const encodedPath = candidatePath.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${repository}/${commit}/${encodedPath}`;
}

const discoveredSources = [];
const candidates = [];

for (const source of registry.sources) {
  const repository = await github(`repos/${source.repository}`);
  const commitDocument = await github(`repos/${source.repository}/commits/${repository.default_branch}`);
  const commit = commitDocument.sha;
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`Unpinned commit returned for ${source.id}`);

  const tree = await github(`repos/${source.repository}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) throw new Error(`GitHub tree is truncated for ${source.id}; narrow the configured roots before accepting this source`);

  const licenseDocument = await github(`repos/${source.repository}/license?ref=${commit}`, { optional: true });
  const licenseFiles = source.license_files.map((licensePath) => {
    const item = tree.tree.find((entry) => entry.type === "blob" && entry.path === licensePath);
    if (!item) throw new Error(`Configured license signal ${licensePath} is missing for ${source.id}`);
    return {
      path: licensePath,
      git_blob_oid: item.sha,
      pinned_url: pinnedRawUrl(source.repository, commit, licensePath)
    };
  });
  const licenseDerivedApproval = licenseFiles.length > 0
    && licenseDocument?.license?.spdx_id
    && licenseDocument.license.spdx_id !== "NOASSERTION";
  const repositoryLicense = {
    status: licenseDerivedApproval ? "license-derived-approval" : "signal-only",
    spdx: licenseDocument?.license?.spdx_id || "NOASSERTION",
    name: licenseDocument?.license?.name || "Repository license requires file-level review",
    api_url: licenseDocument?.html_url || null,
    files: licenseFiles,
    caveat: licenseFiles.length === 0
      ? "No repository license file was detected or configured. Every candidate remains unlicensed until file-level review proves otherwise."
      : licenseDerivedApproval
        ? "Project policy treats the pinned repository SPDX license as publication permission. Embedded third-party ownership is not independently verified and remains a takedown risk."
        : "The repository license could not be mapped to a recognized SPDX identifier, so candidates remain quarantined."
  };

  let sourceCandidateCount = 0;
  for (const entry of tree.tree) {
    if (entry.type !== "blob") continue;
    const matchingRoot = source.candidate_roots.find((candidateRoot) => pathMatches(entry.path, candidateRoot));
    if (!matchingRoot) continue;
    const candidate = {
      id: `${source.id}:${entry.path}`,
      source_id: source.id,
      repository: source.repository,
      source_type: matchingRoot.kind,
      path: entry.path,
      git_blob_oid: entry.sha,
      bytes: entry.size ?? null,
      pinned_url: pinnedRawUrl(source.repository, commit, entry.path),
      repository_license_spdx: repositoryLicense.spdx,
      repository_license_status: repositoryLicense.status,
      rights_review: licenseDerivedApproval ? "approved-by-repository-license-signal" : "required",
      publication_mode: licenseDerivedApproval ? "redistributable" : "quarantine",
      content_intake: "not-fetched"
    };
    candidates.push(candidate);
    sourceCandidateCount += 1;
  }
  if (sourceCandidateCount === 0) throw new Error(`No candidates matched the configured roots for ${source.id}`);
  if (sourceCandidateCount < source.minimum_candidate_count) {
    throw new Error(`Candidate inventory for ${source.id} shrank to ${sourceCandidateCount}; expected at least ${source.minimum_candidate_count}`);
  }

  discoveredSources.push({
    id: source.id,
    provider: "github",
    repository: source.repository,
    homepage: source.homepage,
    source_roles: source.source_roles,
    default_branch: repository.default_branch,
    commit,
    commit_url: `https://github.com/${source.repository}/commit/${commit}`,
    tree_complete: true,
    repository_license: repositoryLicense,
    minimum_candidate_count: source.minimum_candidate_count,
    candidate_count: sourceCandidateCount
  });
}

discoveredSources.sort((left, right) => left.id.localeCompare(right.id));
candidates.sort((left, right) => left.id.localeCompare(right.id));
const bySource = Object.fromEntries(discoveredSources.map((source) => [source.id, source.candidate_count]));
const byType = Object.fromEntries([...new Set(candidates.map((candidate) => candidate.source_type))]
  .sort()
  .map((type) => [type, candidates.filter((candidate) => candidate.source_type === type).length]));

const document = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  policy: {
    default_publication_mode: "quarantine",
    default_rights_review: "required",
    repository_license_is_file_approval: true,
    license_signal_publication_approval: true,
    license_signal_requires_recognized_spdx_and_pinned_license_file: true,
    content_downloaded_during_discovery: false
  },
  counts: {
    sources: discoveredSources.length,
    candidates: candidates.length,
    by_source: bySource,
    by_type: byType,
    publication_modes: Object.fromEntries(Object.entries(candidates.reduce((counts, candidate) => {
      counts[candidate.publication_mode] = (counts[candidate.publication_mode] ?? 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right))),
    rights_review: Object.fromEntries(Object.entries(candidates.reduce((counts, candidate) => {
      counts[candidate.rights_review] = (counts[candidate.rights_review] ?? 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right)))
  },
  sources: discoveredSources,
  candidates
};

await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(JSON.stringify(document.counts));
