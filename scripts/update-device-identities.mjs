import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonSha256 } from "./canonical-json.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(projectRoot, "data", "device-identities", "vendor-mib-sources.json");
const outputPath = path.join(projectRoot, "data", "device-identities", "vendor-mib.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobOid(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function lineAt(text, lineNumber) {
  return text.replace(/\r\n?/g, "\n").split("\n")[lineNumber - 1] ?? null;
}

// Preserve offsets and newlines while excluding comments and quoted prose. This
// keeps prose examples from becoming assignments and lets declaration lines stay
// traceable without publishing source descriptions.
function maskMibNonCode(text) {
  const masked = text.split("");
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if (quoted) {
      if (text[index] === '"' && text[index + 1] === '"') {
        masked[index] = " ";
        masked[index + 1] = " ";
        index += 1;
      } else if (text[index] === '"') {
        masked[index] = " ";
        quoted = false;
      } else if (text[index] !== "\n" && text[index] !== "\r") masked[index] = " ";
      continue;
    }
    if (text[index] === '"') {
      masked[index] = " ";
      quoted = true;
      continue;
    }
    if (text[index] === "-" && text[index + 1] === "-") {
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") {
        masked[index] = " ";
        index += 1;
      }
      index -= 1;
    }
  }
  return masked.join("");
}

export function parseObjectIdentifierAssignments(text) {
  const masked = maskMibNonCode(text);
  const assignments = [];
  const declaration = /^[ \t]*([A-Za-z][A-Za-z0-9-]*)[ \t]+OBJECT[ \t]+IDENTIFIER[ \t\r\n]*::=[ \t\r\n]*\{([^}]+)\}/gm;
  for (const match of masked.matchAll(declaration)) {
    const body = match[2].replace(/\s+/g, " ").trim();
    const parent = body.match(/^([A-Za-z][A-Za-z0-9-]*)(?:\s*\(\s*\d+\s*\))?\b/)?.[1] ?? null;
    const remainder = parent ? body.slice(body.indexOf(parent) + parent.length).replace(/^\s*\(\s*\d+\s*\)/, "").trim() : "";
    const arcs = remainder.split(/\s+/).filter(Boolean).map((token) => Number(token.replace(/[(),]/g, "")));
    if (!parent || arcs.length === 0 || arcs.some((arc) => !Number.isSafeInteger(arc) || arc < 0)) continue;
    assignments.push({
      symbol: match[1],
      parent,
      arcs,
      declaration_line: masked.slice(0, match.index).split("\n").length
    });
  }
  return assignments;
}

function isOid(value) {
  return /^(?:0|1|2)(?:\.(?:0|[1-9][0-9]*))+$/.test(value);
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

function digestWithout(document, field) {
  return canonicalJsonSha256(Object.fromEntries(Object.entries(document).filter(([key]) => key !== field)));
}

async function readVerifiedArtifact(repositoryRoot, artifact, { evidence = false, rootSymbol = null } = {}) {
  const absolutePath = path.resolve(repositoryRoot, artifact.path);
  if (!absolutePath.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)) throw new Error(`Artifact path escaped repository: ${artifact.path}`);
  const bytes = await readFile(absolutePath);
  if (sha256(bytes) !== artifact.sha256) throw new Error(`${artifact.path}: SHA-256 drift`);
  if (gitBlobOid(bytes) !== artifact.git_blob_oid) throw new Error(`${artifact.path}: Git blob drift`);
  const text = bytes.toString("utf8");
  if (evidence && !/sysobject\s*id/i.test(lineAt(text, artifact.sys_object_id_evidence_line) ?? "")) {
    throw new Error(`${artifact.path}: sysObjectID evidence line drift`);
  }
  if (artifact.notice_line !== null && artifact.notice_line !== undefined && !(lineAt(text, artifact.notice_line) ?? "").trim()) {
    throw new Error(`${artifact.path}: artifact notice line drift`);
  }
  if (rootSymbol && !(lineAt(text, artifact.root_declaration_line) ?? "").includes(rootSymbol)) {
    throw new Error(`${artifact.path}: root declaration line drift`);
  }
  return { bytes, text };
}

function resolveAdapterAssignments(adapter, assignments) {
  const bySymbol = new Map();
  for (const assignment of assignments) {
    if (bySymbol.has(assignment.symbol)) throw new Error(`${adapter.id}: duplicate source symbol ${assignment.symbol}`);
    bySymbol.set(assignment.symbol, { ...assignment, oid: null });
  }

  const rootDefinition = bySymbol.get(adapter.root_symbol);
  if (rootDefinition) rootDefinition.oid = adapter.root_oid;
  for (let pass = 0; pass <= bySymbol.size; pass += 1) {
    let changed = false;
    for (const assignment of bySymbol.values()) {
      if (assignment.oid) continue;
      const parentOid = assignment.parent === adapter.root_symbol
        ? adapter.root_oid
        : bySymbol.get(assignment.parent)?.oid;
      if (!parentOid) continue;
      assignment.oid = `${parentOid}.${assignment.arcs.join(".")}`;
      changed = true;
    }
    if (!changed) break;
  }

  const descendantMemo = new Map();
  function isDescendant(symbol, seen = new Set()) {
    if (descendantMemo.has(symbol)) return descendantMemo.get(symbol);
    if (seen.has(symbol)) throw new Error(`${adapter.id}: cyclic OID assignment graph at ${symbol}`);
    seen.add(symbol);
    const assignment = bySymbol.get(symbol);
    const result = Boolean(assignment && (assignment.parent === adapter.root_symbol || isDescendant(assignment.parent, seen)));
    descendantMemo.set(symbol, result);
    return result;
  }

  const descendants = [...bySymbol.values()].filter((assignment) => assignment.symbol !== adapter.root_symbol && isDescendant(assignment.symbol));
  const unresolved = descendants.filter((assignment) => !assignment.oid);
  if (unresolved.length) throw new Error(`${adapter.id}: ${unresolved.length} curated descendants did not resolve`);
  const children = new Map();
  for (const assignment of descendants) children.set(assignment.parent, (children.get(assignment.parent) ?? 0) + 1);
  return { descendants, children };
}

function nearestFamilySymbol(assignment, bySymbol, rootSymbol) {
  if (assignment.parent === rootSymbol) return null;
  return bySymbol.has(assignment.parent) ? assignment.parent : null;
}

function classifyClaim(adapter, assignment, childCount, markers, allowlist, familyAllowlist) {
  if (adapter.force_claim_strength === "product_family" || childCount > 0) return "product_family";
  if (familyAllowlist.includes(assignment.symbol)) return "product_family";
  const symbol = assignment.symbol.toLowerCase();
  if (markers.some((marker) => symbol.includes(marker.toLowerCase()))) return "product_family";
  if (allowlist.includes(assignment.symbol)) return "exact_model";
  if (adapter.id === "cisco-products"
    && (/^ciscoCat9300L?[0-9][A-Za-z0-9]*$/.test(assignment.symbol)
      || /^ciscoC9300X[0-9][A-Za-z0-9]*$/.test(assignment.symbol))) return "exact_model";
  return "vendor_identifier";
}

function modelPresentation(adapter, assignment, claimStrength, familySymbol) {
  if (adapter.id === "cisco-products") {
    const catalyst9300 = assignment.symbol.match(/^ciscoCat9300(L?)([0-9][A-Za-z0-9]*)$/);
    const catalyst9300x = assignment.symbol.match(/^ciscoC9300X([0-9][A-Za-z0-9]*)$/);
    if (claimStrength === "exact_model" && catalyst9300) return {
      model: `C9300${catalyst9300[1]}-${catalyst9300[2]}`,
      model_identifier: assignment.symbol,
      model_normalization: "cisco-catalyst-9300-sku-v1",
      product_family: "Catalyst 9300"
    };
    if (claimStrength === "exact_model" && catalyst9300x) return {
      model: `C9300X-${catalyst9300x[1]}`,
      model_identifier: assignment.symbol,
      model_normalization: "cisco-catalyst-9300-sku-v1",
      product_family: "Catalyst 9300"
    };
    if (assignment.symbol === "ciscoCat9300FixedSwitchStack") return {
      model: null,
      model_identifier: null,
      model_normalization: null,
      product_family: "Catalyst 9300"
    };
  }
  if (claimStrength === "exact_model") return {
    model: assignment.symbol,
    model_identifier: assignment.symbol,
    model_normalization: "reviewed-source-symbol-model-v1",
    product_family: familySymbol
  };
  return { model: null, model_identifier: null, model_normalization: null, product_family: familySymbol };
}

export function conflictGroups(records) {
  const byOid = new Map();
  for (const record of records) byOid.set(record.sys_object_id, [...(byOid.get(record.sys_object_id) ?? []), record]);
  return [...byOid.entries()].filter(([, claims]) => {
    const materialClaims = new Set(claims.map((claim) => JSON.stringify([
      claim.enterprise_number,
      claim.claim_strength,
      claim.model,
      claim.product_family,
      claim.source_symbol
    ])));
    return materialClaims.size > 1;
  }).map(([sysObjectId, claims]) => ({
    sys_object_id: sysObjectId,
    record_ids: claims.map((claim) => claim.id).sort()
  })).sort((left, right) => numericOidCompare(left.sys_object_id, right.sys_object_id));
}

export async function buildVendorMibIdentityDataset(manifest, { repositoryRoot, penDocument }) {
  if (manifest.schema_version !== 1) throw new Error("Unsupported vendor identity source manifest schema");
  if (manifest.policy.layer !== "vendor-mib-factual-metadata" || manifest.policy.publication_mode !== "metadata-only") {
    throw new Error("Vendor identity source policy drifted");
  }
  if (manifest.adapters.length < 10) throw new Error("At least 10 vendor adapters are required");
  if (canonicalJsonSha256(penDocument) !== manifest.enterprise_registry.document_canonical_sha256) {
    throw new Error("IANA PEN document drift");
  }

  const repositoryCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  if (repositoryCommit !== manifest.source_repository.commit) throw new Error(`LibreNMS revision drift: ${repositoryCommit}`);
  for (const artifact of manifest.source_repository.license_signal.files) await readVerifiedArtifact(repositoryRoot, artifact);

  const penNames = new Map(penDocument.records);
  const organizationLinks = new Map(manifest.organization_link_snapshot.links.map((link) => [link.pen, link.organization_key]));
  const sources = [];
  const records = [];
  for (const adapter of [...manifest.adapters].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!isOid(adapter.root_oid) || Number(adapter.root_oid.split(".")[6]) !== adapter.enterprise_number) {
      throw new Error(`${adapter.id}: root OID and enterprise number disagree`);
    }
    const organizationName = penNames.get(adapter.enterprise_number);
    if (!organizationName) throw new Error(`${adapter.id}: PEN ${adapter.enterprise_number} is absent from the pinned IANA registry`);
    const definition = await readVerifiedArtifact(repositoryRoot, adapter.definition_artifact, { evidence: true });
    await readVerifiedArtifact(repositoryRoot, adapter.root_artifact, { rootSymbol: adapter.root_symbol });
    const assignments = parseObjectIdentifierAssignments(definition.text);
    const { descendants, children } = resolveAdapterAssignments(adapter, assignments);
    const bySymbol = new Map(descendants.map((assignment) => [assignment.symbol, assignment]));
    const organizationKey = organizationLinks.get(adapter.enterprise_number) ?? null;
    const sourceUrl = `https://github.com/librenms/librenms/blob/${manifest.source_repository.commit}/${adapter.definition_artifact.path}`;
    sources.push({
      id: adapter.id,
      layer: manifest.policy.layer,
      vendor: adapter.vendor,
      enterprise_number: adapter.enterprise_number,
      pen: adapter.enterprise_number,
      organization_name: organizationName,
      organization_key: organizationKey,
      root_symbol: adapter.root_symbol,
      root_oid: adapter.root_oid,
      source_repository_commit: manifest.source_repository.commit,
      source_path: adapter.definition_artifact.path,
      evidence_url: sourceUrl,
      source_url: sourceUrl,
      git_blob_oid: adapter.definition_artifact.git_blob_oid,
      sha256: adapter.definition_artifact.sha256,
      source_license_signal: manifest.source_repository.license_signal.spdx,
      artifact_rights: adapter.definition_artifact.artifact_rights,
      publication_mode: "metadata-only",
      raw_distribution: "denied",
      official_source_url: adapter.official_source.url ?? null,
      official_source_status: adapter.official_source.status,
      official_source: adapter.official_source
    });

    for (const assignment of descendants) {
      const claimStrength = classifyClaim(
        adapter,
        assignment,
        children.get(assignment.symbol) ?? 0,
        manifest.policy.family_symbol_markers,
        manifest.policy.exact_model_symbol_allowlist,
        manifest.policy.product_family_symbol_allowlist
      );
      const familySymbol = claimStrength === "product_family"
        ? assignment.symbol
        : claimStrength === "exact_model" ? nearestFamilySymbol(assignment, bySymbol, adapter.root_symbol) : null;
      const presentation = modelPresentation(adapter, assignment, claimStrength, familySymbol);
      records.push({
        id: `${adapter.id}:${assignment.oid}:${assignment.symbol}`,
        sys_object_id: assignment.oid,
        match_type: "exact",
        claim_strength: claimStrength,
        confidence: "high",
        vendor: adapter.vendor,
        enterprise_number: adapter.enterprise_number,
        pen: adapter.enterprise_number,
        organization_name: organizationName,
        organization_key: organizationKey,
        model: presentation.model,
        model_identifier: presentation.model_identifier,
        model_normalization: presentation.model_normalization,
        product_family: presentation.product_family,
        source_symbol: assignment.symbol,
        parent_symbol: assignment.parent,
        source_id: adapter.id,
        declaration_line: assignment.declaration_line,
        publication_mode: "metadata-only",
        field_provenance: "vendor-mib-assignment-v1"
      });
    }
  }

  records.sort((left, right) => numericOidCompare(left.sys_object_id, right.sys_object_id)
    || left.source_id.localeCompare(right.source_id)
    || left.source_symbol.localeCompare(right.source_symbol));
  const conflicts = conflictGroups(records);
  const uniqueOids = new Set(records.map((record) => record.sys_object_id));
  const counts = {
    sources: sources.length,
    vendor_families: new Set(sources.map((source) => source.enterprise_number)).size,
    records: records.length,
    exact_oid_keys: uniqueOids.size,
    exact_models: records.filter((record) => record.claim_strength === "exact_model").length,
    product_families: records.filter((record) => record.claim_strength === "product_family").length,
    vendor_identifiers: records.filter((record) => record.claim_strength === "vendor_identifier").length,
    conflict_oids: conflicts.length,
    organization_keys: sources.filter((source) => source.organization_key !== null).length
  };
  const document = {
    schema_version: 1,
    snapshot_id: manifest.snapshot_id,
    snapshot_date: manifest.snapshot_date,
    layer: manifest.policy.layer,
    publication_mode: "metadata-only",
    raw_distribution: "denied",
    source_manifest_sha256: canonicalJsonSha256(manifest),
    dataset_sha256: null,
    field_provenance_contracts: {
      "vendor-mib-assignment-v1": {
        sys_object_id: "Resolved only through assignments descending from the adapter's reviewed sysObjectID root.",
        source_symbol: "Exact source declaration symbol; no prose description is copied.",
        model: "Only an explicitly reviewed model normalization or allowlist may populate this field; generic source symbols remain non-model object identifiers.",
        product_family: "Source symbol of an internal or conservatively classified family node.",
        enterprise_number: "Adapter root cross-checked against the pinned IANA PEN snapshot.",
        organization_key: "Exact reviewed PEN link from the pinned public macvendor organization-link snapshot, otherwise null.",
        vendor: "Curated adapter label; not inferred from source prose."
      }
    },
    normalization_rules: {
      "reviewed-source-symbol-model-v1": "Exact source symbol explicitly listed by policy review as a whole-device model; no current source relies on this rule.",
      "cisco-catalyst-9300-sku-v1": "Narrow reviewed conversion of Cisco Catalyst 9300 SKU symbols to C9300/C9300L/C9300X display identifiers; source_symbol and model_identifier remain unchanged."
    },
    rights_boundary: {
      repository_license_signal: manifest.source_repository.license_signal.spdx,
      artifact_notice_precedence: "Artifact-specific restrictive notice or missing redistribution grant overrides raw publication.",
      descriptions_included: false,
      raw_mib_included: false
    },
    counts,
    sources,
    conflicts,
    records
  };
  document.dataset_sha256 = digestWithout(document, "dataset_sha256");
  return document;
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const penPath = path.join(projectRoot, manifest.enterprise_registry.path);
  const penDocument = JSON.parse(await readFile(penPath, "utf8"));
  const repositoryRoot = path.resolve(projectRoot, process.env.LIBRENMS_IDENTITY_SOURCE ?? manifest.source_repository.local_path);
  const document = await buildVendorMibIdentityDataset(manifest, { repositoryRoot, penDocument });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(document.counts)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
