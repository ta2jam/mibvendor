#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildDeviceIdentityContributionReport,
  emptyContributionEventsDocument,
  emptyContributionReviewsDocument,
  parseDeterministicContributionJson,
  validateDeviceIdentityContributionBundle
} from "./lib/device-identity-contributions.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataRoot = path.join(projectRoot, "data", "device-identity-contributions");

async function readJson(filePath, { deterministic = false } = {}) {
  const source = await readFile(filePath, "utf8");
  return deterministic ? parseDeterministicContributionJson(source, path.relative(projectRoot, filePath)) : JSON.parse(source);
}

function validateSchemaEnvelope(schema, expectedId, expectedTitle) {
  const failures = [];
  if (schema?.$schema !== "https://json-schema.org/draft/2020-12/schema") failures.push(`${expectedTitle} schema draft drift`);
  if (schema?.$id !== expectedId) failures.push(`${expectedTitle} schema id drift`);
  if (schema?.title !== expectedTitle || schema?.type !== "object" || schema?.additionalProperties !== false) {
    failures.push(`${expectedTitle} schema root is not closed`);
  }
  if (!Array.isArray(schema?.required) || !schema.required.includes("schema_version")) {
    failures.push(`${expectedTitle} schema does not require schema_version`);
  }
  return failures;
}

function sameStrings(actual, expected) {
  return Array.isArray(actual)
    && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export async function loadDeviceIdentityContributionBundle({ root = projectRoot } = {}) {
  const contributionRoot = path.join(root, "data", "device-identity-contributions");
  const [events, reviews, report] = await Promise.all([
    readJson(path.join(contributionRoot, "events.json"), { deterministic: true }),
    readJson(path.join(contributionRoot, "reviews.json"), { deterministic: true }),
    readJson(path.join(contributionRoot, "review-report.json"), { deterministic: true })
  ]);
  return { events, reviews, report };
}

export async function validateDeviceIdentityContributionRepository({ root = projectRoot } = {}) {
  const failures = [];
  const [bundle, contributionSchema, reviewSchema, contributionExample, reviewExample, dockerfile] = await Promise.all([
    loadDeviceIdentityContributionBundle({ root }),
    readJson(path.join(root, "contracts", "device-identity-contribution-event.schema.json")),
    readJson(path.join(root, "contracts", "device-identity-contribution-review.schema.json")),
    readJson(path.join(root, "contracts", "examples", "device-identity-contribution-event.json"), { deterministic: true }),
    readJson(path.join(root, "contracts", "examples", "device-identity-contribution-review.json"), { deterministic: true }),
    readFile(path.join(root, "Dockerfile"), "utf8")
  ]);
  failures.push(...validateSchemaEnvelope(
    contributionSchema,
    "https://mibvendor.io/schemas/device-identity-contribution-event.schema.json",
    "mibvendor device identity contribution event"
  ));
  failures.push(...validateSchemaEnvelope(
    reviewSchema,
    "https://mibvendor.io/schemas/device-identity-contribution-review.schema.json",
    "mibvendor device identity contribution review"
  ));
  if (dockerfile.includes("data/device-identity-contributions")) {
    failures.push("quarantined community contribution ledgers must not enter the production image");
  }
  for (const [schema, example, label] of [
    [contributionSchema, contributionExample, "contribution event"],
    [reviewSchema, reviewExample, "contribution review"]
  ]) {
    const schemaFields = Object.keys(schema?.properties ?? {}).sort();
    const requiredFields = [...(schema?.required ?? [])].sort();
    const exampleFields = Object.keys(example ?? {}).sort();
    if (JSON.stringify(schemaFields) !== JSON.stringify(requiredFields)
      || JSON.stringify(schemaFields) !== JSON.stringify(exampleFields)) {
      failures.push(`${label} schema, required fields, and synthetic example fields differ`);
    }
  }
  if (contributionSchema?.$defs?.enterpriseOid?.maxLength !== 1_024
    || contributionSchema?.$defs?.claim?.properties?.enterprise_number?.minimum !== 1
    || contributionSchema?.$defs?.sourceUrl?.maxLength !== 2_048) {
    failures.push("contribution schema is missing the bounded OID, PEN, or source URL limits");
  }
  if (!sameStrings(contributionSchema?.properties?.reason?.enum, [
    "new-public-evidence",
    "corrected-public-evidence",
    "accuracy-withdrawal",
    "rights-boundary-withdrawal",
    "contributor-withdrawal"
  ])) {
    failures.push("contribution event schema reason codes drifted from the executable contract");
  }
  if (!sameStrings(reviewSchema?.properties?.reason?.enum, [
    "evidence-approved-for-scope",
    "insufficient-evidence",
    "rights-scope-unclear",
    "sensitive-data-risk",
    "withdrawal-confirmed"
  ])) {
    failures.push("contribution review schema reason codes drifted from the executable contract");
  }
  try {
    buildDeviceIdentityContributionReport(
      { ...emptyContributionEventsDocument(), events: [contributionExample] },
      { ...emptyContributionReviewsDocument(), reviews: [reviewExample] }
    );
  } catch (error) {
    failures.push(...(error.issues ?? [`synthetic contribution examples are invalid: ${error.message}`]));
  }
  try {
    return { ...validateDeviceIdentityContributionBundle(bundle), schema_failures: failures };
  } catch (error) {
    failures.push(...(error.issues ?? [error.message]));
    return { schema_failures: failures };
  }
}

async function main() {
  let result;
  try {
    result = await validateDeviceIdentityContributionRepository();
  } catch (error) {
    process.stderr.write(`${error.issues?.join("\n") ?? error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.schema_failures.length) {
    process.stderr.write(`${result.schema_failures.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({
    events: result.events,
    reviews: result.reviews,
    pending: result.pending,
    conflicts: result.conflicts,
    automatic_publication: result.automatic_publication
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
