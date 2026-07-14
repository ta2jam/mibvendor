import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  canonicalModuleDigest,
  dataReleaseDigest,
  sourceSnapshotDigest,
} from "./canonical-json.mjs";

const ROOT = process.cwd();
const DRAFT = "https://json-schema.org/draft/2020-12/schema";

const FILES = {
  schemas: [
    "source-snapshot.schema.json",
    "canonical-module.schema.json",
    "data-release.schema.json",
    "active-release-pointer.schema.json",
    "parser-adapter.schema.json",
  ],
  examples: {
    source: "source-snapshot.json",
    canonical: "canonical-module.json",
    release: "data-release.json",
    pointer: "active-release-pointer.json",
    adapterFailure: "parser-adapter-failure.json",
  },
};

export class FoundationValidationError extends Error {
  constructor(issues) {
    super(`Foundation validation failed with ${issues.length} issue(s)`);
    this.name = "FoundationValidationError";
    this.issues = issues;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function loadFoundation(root = ROOT) {
  const contracts = path.join(root, "contracts");
  const schemas = new Map();
  for (const name of FILES.schemas) schemas.set(name, await readJson(path.join(contracts, name)));

  const examples = {};
  for (const [key, name] of Object.entries(FILES.examples)) {
    examples[key] = await readJson(path.join(contracts, "examples", name));
  }

  return {
    schemas,
    examples,
    golden: await readJson(path.join(root, "docs", "foundation", "ux-golden-tasks.json")),
    coverage: await readJson(path.join(root, "docs", "foundation", "prototype-golden-coverage.json")),
  };
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function resolvePointer(document, pointer) {
  if (pointer === "#") return document;
  if (!pointer.startsWith("#/")) return undefined;
  return pointer.slice(2).split("/").reduce((value, token) => {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    return value?.[key];
  }, document);
}

function resolveReference(reference, currentName, schemas) {
  const [filePart, fragment = ""] = reference.split("#", 2);
  const targetName = filePart || currentName;
  const target = schemas.get(targetName);
  if (!target) return null;
  const schema = fragment ? resolvePointer(target, `#${fragment}`) : target;
  return schema ? { name: targetName, schema } : null;
}

function checkFormat(value, format) {
  if (typeof value !== "string") return true;
  if (format === "uri") {
    try {
      const parsed = new URL(value);
      return Boolean(parsed.protocol && parsed.hostname);
    } catch {
      return false;
    }
  }
  if (format === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (format === "date-time") return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
  return false;
}

function validateValue(value, schema, location, currentName, schemas, issues) {
  if (schema.$ref) {
    const resolved = resolveReference(schema.$ref, currentName, schemas);
    if (!resolved) {
      issues.push(`${location}: unresolved schema reference ${schema.$ref}`);
      return;
    }
    validateValue(value, resolved.schema, location, resolved.name, schemas, issues);
    return;
  }

  if (schema.anyOf) {
    const alternatives = schema.anyOf.map((candidate) => {
      const candidateIssues = [];
      validateValue(value, candidate, location, currentName, schemas, candidateIssues);
      return candidateIssues;
    });
    if (!alternatives.some((candidateIssues) => candidateIssues.length === 0)) {
      issues.push(`${location}: value does not match any allowed schema`);
    }
    return;
  }

  if (schema.const !== undefined && !jsonEqual(value, schema.const)) {
    issues.push(`${location}: expected constant ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => jsonEqual(value, candidate))) {
    issues.push(`${location}: value is outside the allowed enum`);
  }

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((type) => typeMatches(value, type))) {
      issues.push(`${location}: expected type ${allowed.join("|")}`);
      return;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(`${location}: string is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(`${location}: string is too long`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) issues.push(`${location}: string does not match ${schema.pattern}`);
    if (schema.format && !checkFormat(value, schema.format)) issues.push(`${location}: invalid ${schema.format}`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${location}: number is below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(`${location}: number is above maximum`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${location}: array has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(`${location}: array has too many items`);
    if (schema.uniqueItems) {
      const encoded = value.map((item) => JSON.stringify(item));
      if (new Set(encoded).size !== encoded.length) issues.push(`${location}: array items must be unique`);
    }
    if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, `${location}[${index}]`, currentName, schemas, issues));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) issues.push(`${location}: missing required property ${required}`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) {
        validateValue(child, schema.properties[key], `${location}.${key}`, currentName, schemas, issues);
      } else if (schema.additionalProperties === false) {
        issues.push(`${location}: unexpected property ${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateValue(child, schema.additionalProperties, `${location}.${key}`, currentName, schemas, issues);
      }
    }
  }
}

function inspectSchema(schema, name, schemas, issues, location = name) {
  if (!schema || typeof schema !== "object") return;
  if (schema.required) {
    for (const key of schema.required) {
      if (!schema.properties || !Object.hasOwn(schema.properties, key)) {
        issues.push(`${location}: required key ${key} has no property schema`);
      }
    }
  }
  if (schema.$ref && !resolveReference(schema.$ref, name, schemas)) {
    issues.push(`${location}: unresolved schema reference ${schema.$ref}`);
  }
  for (const [key, child] of Object.entries(schema)) {
    if (child && typeof child === "object") {
      if (Array.isArray(child)) child.forEach((item, index) => inspectSchema(item, name, schemas, issues, `${location}.${key}[${index}]`));
      else inspectSchema(child, name, schemas, issues, `${location}.${key}`);
    }
  }
}

function validateSource(source, location, issues) {
  const scopes = source.rights?.scopes ?? {};
  if (["P", "Q"].includes(source.tier) && Object.values(scopes).some((scope) => scope === "approved")) {
    issues.push(`${location}: tier ${source.tier} cannot approve public output scopes`);
  }
  if (source.parser_use === "denied" && source.tier !== "Q") {
    issues.push(`${location}: parser denial requires quarantine tier Q`);
  }
  try {
    if (source.snapshot_id !== `src_${sourceSnapshotDigest(source)}`) {
      issues.push(`${location}: snapshot_id does not match the RFC 8785 content digest`);
    }
  } catch (error) {
    issues.push(`${location}: cannot compute snapshot digest (${error.message})`);
  }
}

function validateCanonical(canonical, issues) {
  validateSource(canonical.source, "canonical.source", issues);
  try {
    if (canonical.canonical_sha256 !== canonicalModuleDigest(canonical)) {
      issues.push("canonical.canonical_sha256 does not match the RFC 8785 content digest");
    }
  } catch (error) {
    issues.push(`canonical: cannot compute content digest (${error.message})`);
  }
  const objects = canonical.module?.objects ?? [];
  const stableIds = objects.map((object) => object.stable_id);
  const definitionIds = objects.map((object) => object.definition_id);
  if (new Set(stableIds).size !== stableIds.length) issues.push("canonical.module.objects: duplicate stable_id");
  if (new Set(definitionIds).size !== definitionIds.length) issues.push("canonical.module.objects: duplicate definition_id");
  const known = new Set(stableIds);
  const relationshipFields = ["parent", "table", "row", "augments", "indexes", "notification_objects"];
  for (const object of objects) {
    if ((object.oid === null) !== (object.oid_arcs === null)) {
      issues.push(`${object.stable_id}: oid and oid_arcs must both be null or both be populated`);
    } else if (object.oid !== null && object.oid !== object.oid_arcs.join(".")) {
      issues.push(`${object.stable_id}: oid does not match oid_arcs`);
    }
    for (const field of relationshipFields) {
      const raw = object.relationships?.[field];
      const references = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw];
      for (const reference of references) {
        if (!known.has(reference)) issues.push(`${object.stable_id}: ${field} references unknown stable_id ${reference}`);
      }
    }
    if (object.description?.visibility === "public" && canonical.source.rights.scopes.rendered_text !== "approved") {
      issues.push(`${object.stable_id}: public description requires rendered_text approval`);
    }
  }
}

function validateRelease(release, canonical, issues) {
  for (const source of release.sources ?? []) validateSource(source, "release.sources", issues);
  if (release.counts.sources !== release.sources.length) issues.push("release.counts.sources does not match sources length");
  if (release.counts.modules !== release.modules.length) issues.push("release.counts.modules does not match modules length");
  if (release.counts.objects !== canonical.module.objects.length) issues.push("release.counts.objects does not match canonical object count");
  try {
    if (release.manifest_sha256 !== dataReleaseDigest(release)) issues.push("release.manifest_sha256 does not match the RFC 8785 content digest");
  } catch (error) {
    issues.push(`release: cannot compute manifest digest (${error.message})`);
  }
  const sourceIds = new Set(release.sources.map((source) => source.snapshot_id));
  for (const module of release.modules) {
    if (!sourceIds.has(module.source_snapshot_id)) issues.push(`release module references unknown source snapshot ${module.source_snapshot_id}`);
  }
  const entry = release.modules.find((module) => module.definition_id === canonical.module.definition_id);
  if (!entry) issues.push("release does not include the canonical example module");
  else {
    if (entry.canonical_sha256 !== canonical.canonical_sha256) issues.push("release module hash does not match canonical example");
    if (entry.source_snapshot_id !== canonical.source.snapshot_id) issues.push("release module source does not match canonical example");
  }
}

function validateAdapter(adapter, issues) {
  const hasError = adapter.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (adapter.outcome === "failure") {
    if (adapter.canonical_module !== null) issues.push("failed adapter result must not carry a canonical module");
    if (!hasError) issues.push("failed adapter result requires an error diagnostic");
  }
  if (adapter.outcome === "success") {
    if (adapter.canonical_module === null) issues.push("successful adapter result requires a canonical module");
    if (hasError) issues.push("successful adapter result must not carry an error diagnostic");
  }
  for (const diagnostic of adapter.diagnostics) {
    if (/(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(diagnostic.message)) {
      issues.push("adapter diagnostic exposes an absolute local path");
    }
  }
}

function validateGolden(golden, issues) {
  if (golden.status !== "provisional_phase0_open") issues.push("golden tasks must remain provisional while Phase 0 is open");
  if (!Array.isArray(golden.tasks) || golden.tasks.length !== 20) issues.push("golden task suite must contain exactly 20 tasks");
  const ids = golden.tasks?.map((task) => task.id) ?? [];
  const expected = Array.from({ length: 20 }, (_, index) => `G${String(index + 1).padStart(2, "0")}`);
  if (!jsonEqual(ids, expected)) issues.push("golden task IDs must be unique and ordered G01 through G20");
  const personas = new Set();
  for (const task of golden.tasks ?? []) {
    personas.add(task.persona);
    if (typeof task.input !== "string" || task.input.length < 1 || task.input.length > 500) issues.push(`${task.id}: input must be 1..500 characters`);
    if (!Array.isArray(task.assertions) || task.assertions.length < 2) issues.push(`${task.id}: at least two assertions are required`);
    if (!Array.isArray(task.source_task_ids) || task.source_task_ids.length < 1 || task.source_task_ids.some((id) => !/^[BEA]\d{2}$/.test(id))) {
      issues.push(`${task.id}: invalid source task IDs`);
    }
  }
  for (const required of ["beginner", "expert", "api-tool-developer"]) {
    if (!personas.has(required)) issues.push(`golden tasks are missing persona ${required}`);
  }
}

function validateCoverage(coverage, golden, issues) {
  if (coverage.status !== "provisional_phase0_open") issues.push("prototype coverage must remain provisional while Phase 0 is open");
  if (!/^0\.\d+\.\d+-alpha\.\d+$/.test(coverage.prototype_release ?? "")) issues.push("prototype coverage requires an alpha release identifier");
  const expectedIds = golden.tasks.map((task) => task.id);
  const actualIds = coverage.tasks?.map((task) => task.id) ?? [];
  if (!jsonEqual(actualIds, expectedIds)) issues.push("prototype coverage IDs must exactly match the golden task order");
  for (const task of coverage.tasks ?? []) {
    if (!["implemented", "partial", "not-implemented"].includes(task.status)) issues.push(`${task.id}: invalid coverage status`);
    if (!Array.isArray(task.evidence)) issues.push(`${task.id}: coverage evidence must be an array`);
    if (["implemented", "partial"].includes(task.status) && (!task.evidence?.length || task.evidence.some((item) => typeof item !== "string" || !item.trim()))) {
      issues.push(`${task.id}: claimed coverage requires non-empty evidence`);
    }
    if (task.status === "not-implemented" && task.evidence?.length) issues.push(`${task.id}: not-implemented coverage cannot claim evidence`);
  }
}

export function validateFoundation(bundle) {
  const issues = [];
  const schemaIds = new Set();
  for (const [name, schema] of bundle.schemas) {
    if (schema.$schema !== DRAFT) issues.push(`${name}: must declare JSON Schema 2020-12`);
    if (!schema.$id) issues.push(`${name}: missing $id`);
    else if (schemaIds.has(schema.$id)) issues.push(`${name}: duplicate $id ${schema.$id}`);
    else schemaIds.add(schema.$id);
    inspectSchema(schema, name, bundle.schemas, issues);
  }

  const mappings = [
    ["source", "source-snapshot.schema.json"],
    ["canonical", "canonical-module.schema.json"],
    ["release", "data-release.schema.json"],
    ["pointer", "active-release-pointer.schema.json"],
    ["adapterFailure", "parser-adapter.schema.json"],
  ];
  for (const [exampleName, schemaName] of mappings) {
    validateValue(bundle.examples[exampleName], bundle.schemas.get(schemaName), `examples.${exampleName}`, schemaName, bundle.schemas, issues);
  }

  validateSource(bundle.examples.source, "examples.source", issues);
  if (!jsonEqual(bundle.examples.source, bundle.examples.canonical.source)) issues.push("canonical source does not equal the standalone source fixture");
  if (!jsonEqual(bundle.examples.source, bundle.examples.release.sources[0])) issues.push("release source does not equal the standalone source fixture");
  validateCanonical(bundle.examples.canonical, issues);
  validateRelease(bundle.examples.release, bundle.examples.canonical, issues);
  if (bundle.examples.pointer.active_release !== bundle.examples.release.release_id) issues.push("active pointer does not target the example release");
  validateAdapter(bundle.examples.adapterFailure, issues);
  validateGolden(bundle.golden, issues);
  validateCoverage(bundle.coverage, bundle.golden, issues);

  if (issues.length) throw new FoundationValidationError(issues);
  const coverageCounts = Object.fromEntries(["implemented", "partial", "not-implemented"].map((status) => [status, bundle.coverage.tasks.filter((task) => task.status === status).length]));
  return {
    schemas: bundle.schemas.size,
    examples: Object.keys(bundle.examples).length,
    objects: bundle.examples.canonical.module.objects.length,
    goldenTasks: bundle.golden.tasks.length,
    coverage: coverageCounts,
  };
}

export async function run(root = ROOT) {
  return validateFoundation(await loadFoundation(root));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const result = await run();
    console.log(`Foundation contracts passed (${result.schemas} schemas, ${result.examples} examples, ${result.objects} objects, ${result.goldenTasks} golden tasks; coverage ${result.coverage.implemented} implemented, ${result.coverage.partial} partial, ${result.coverage["not-implemented"]} not implemented).`);
  } catch (error) {
    if (error instanceof FoundationValidationError) {
      for (const issue of error.issues) console.error(`ERROR: ${issue}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
