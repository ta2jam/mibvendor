#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { canonicalJsonSha256 } from "./canonical-json.mjs";

const FIXED_RFC_UNIVERSE = Object.freeze([
  5427, 5428, 5488, 5519, 5525, 5542, 5591,
  5592, 5601, 5602, 5603, 5604, 5605, 5643,
]);
const ACCEPTED = "accepted-for-candidate-build";
const CLOSED_DECISIONS = new Set([ACCEPTED, "unknown", "rejected"]);
const RFC_STATUSES = new Set(["PROPOSED STANDARD", "INTERNET STANDARD", "EXPERIMENTAL"]);
const REQUIRED_BSD_CONDITIONS = Object.freeze([
  "source-notice-retention",
  "binary-notice-reproduction",
  "non-endorsement",
  "warranty-disclaimer",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isSortedUniqueIntegers(values) {
  return Array.isArray(values)
    && values.every(Number.isInteger)
    && values.every((value, index) => index === 0 || value > values[index - 1]);
}

function reviewDigest(document) {
  const projection = { ...document };
  delete projection.manifest_sha256;
  return canonicalJsonSha256(projection);
}

function assertActiveVariant(module, candidate, catalogById, crossCheckBaseline) {
  const variant = module.active_same_name_variant;
  if (variant === null) {
    if (crossCheckBaseline) {
      assert(!catalogById.has(module.name),
        `RFC ${candidate.rfc} ${module.name} is active in the baseline but the review omits its independent variant`);
    }
    return 0;
  }

  assert(variant && typeof variant === "object" && !Array.isArray(variant),
    `RFC ${candidate.rfc} ${module.name} has an invalid active_same_name_variant`);
  assert(variant.relationship === "independently-licensed-variant-not-successor",
    `RFC ${candidate.rfc} ${module.name} conflates an independent variant with a successor`);
  assert(typeof variant.source_id === "string" && variant.source_id,
    `RFC ${candidate.rfc} ${module.name} active variant has no source_id`);
  assert(isSha256(variant.artifact_sha256),
    `RFC ${candidate.rfc} ${module.name} active variant has an invalid artifact_sha256`);

  if (crossCheckBaseline) {
    const active = catalogById.get(module.name);
    assert(active, `RFC ${candidate.rfc} ${module.name} active baseline variant is missing`);
    assert(active.source_id === variant.source_id,
      `RFC ${candidate.rfc} ${module.name} active baseline source_id drifted`);
    assert(active.artifact_sha256 === variant.artifact_sha256,
      `RFC ${candidate.rfc} ${module.name} active baseline checksum drifted`);
  }
  return 1;
}

export function validateLegacyRfcReview(document, { catalog = null } = {}) {
  assert(document?.schema_version === 1, "schema_version must be 1");
  assert(document.review_id === "ietf-transition-rfc-file-review-2026-07-20.1", "unexpected review_id");
  assert(document.reviewed_at === "2026-07-20", "reviewed_at must pin the review date");
  assert(document.baseline_data_release === "license-signaled-2026-07-20.2", "unexpected baseline_data_release");
  assert(document.activation_policy === "review-does-not-activate-content", "review must not imply activation");
  assert(document.source_index?.url === "https://www.rfc-editor.org/rfc-index.xml",
    "source_index must be the official RFC Editor index");
  assert(isSha256(document.source_index.sha256), "source_index.sha256 must be a lowercase SHA-256");
  assert(Array.isArray(document.fixed_universe), "fixed_universe must be an array");
  assert(JSON.stringify(document.fixed_universe) === JSON.stringify(FIXED_RFC_UNIVERSE),
    "fixed_universe differs from the 14 reviewed RFCs");
  assert(Array.isArray(document.candidates) && document.candidates.length === FIXED_RFC_UNIVERSE.length,
    "candidates must contain exactly the 14 reviewed RFCs");

  const crossCheckBaseline = Boolean(catalog && catalog.data_release === document.baseline_data_release);
  const catalogById = new Map((catalog?.modules ?? []).map((module) => [module.id, module]));
  const moduleNames = new Set();
  let moduleDefinitions = 0;
  let accepted = 0;
  let unknown = 0;
  let rejected = 0;
  let quarantined = 0;
  let activeSameNameAlternates = 0;

  for (let index = 0; index < document.candidates.length; index += 1) {
    const candidate = document.candidates[index];
    assert(candidate.rfc === FIXED_RFC_UNIVERSE[index], "candidates must be RFC-sorted and match fixed_universe");
    assert(typeof candidate.title === "string" && candidate.title, `RFC ${candidate.rfc} has no title`);
    assert(RFC_STATUSES.has(candidate.status), `RFC ${candidate.rfc} has an invalid RFC status`);
    assert(/^2009-(?:03|04|05|06|07|08)$/.test(candidate.published),
      `RFC ${candidate.rfc} has an invalid pinned publication date`);
    assert(candidate.source_url === `https://www.rfc-editor.org/rfc/rfc${candidate.rfc}.txt`,
      `RFC ${candidate.rfc} does not use its official text URL`);
    assert(isSha256(candidate.source_sha256), `RFC ${candidate.rfc} has an invalid source_sha256`);
    assert(Number.isInteger(candidate.source_bytes) && candidate.source_bytes > 0,
      `RFC ${candidate.rfc} has an invalid source byte count`);
    assert(CLOSED_DECISIONS.has(candidate.decision), `RFC ${candidate.rfc} has an invalid decision`);
    assert(typeof candidate.decision_reason === "string" && candidate.decision_reason,
      `RFC ${candidate.rfc} has no machine-readable decision reason`);

    assert(candidate.notice?.kind === "embedded-bsd-3-clause",
      `RFC ${candidate.rfc} has no file-specific BSD notice classification`);
    assert(candidate.notice.location === "module-description",
      `RFC ${candidate.rfc} has an invalid notice location`);
    assert(candidate.notice.copyright_year === 2009,
      `RFC ${candidate.rfc} has an invalid notice copyright year`);
    assert(JSON.stringify(candidate.notice.conditions) === JSON.stringify(REQUIRED_BSD_CONDITIONS),
      `RFC ${candidate.rfc} does not record the complete BSD-3-Clause conditions`);
    assert(typeof candidate.notice.document_pre_5378_legend === "boolean",
      `RFC ${candidate.rfc} must record the document-level pre-5378 legend signal`);

    assert(candidate.relationships && typeof candidate.relationships === "object",
      `RFC ${candidate.rfc} has no RFC relationship record`);
    for (const relation of ["obsoletes", "obsoleted_by", "updates", "updated_by"]) {
      assert(isSortedUniqueIntegers(candidate.relationships[relation]),
        `RFC ${candidate.rfc} ${relation} must be a sorted unique integer array`);
    }
    assert(candidate.relationships.same_name_successor === null,
      `RFC ${candidate.rfc} has an unsupported same-name successor claim`);

    assert(Array.isArray(candidate.modules) && candidate.modules.length > 0,
      `RFC ${candidate.rfc} has no module definitions`);
    assert(candidate.notice.grant_occurrences === candidate.modules.length,
      `RFC ${candidate.rfc} does not bind one embedded grant to each module definition`);
    for (const module of candidate.modules) {
      assert(typeof module.name === "string" && /^[A-Za-z][A-Za-z0-9-]*$/.test(module.name),
        `RFC ${candidate.rfc} has an invalid module name`);
      assert(!moduleNames.has(module.name), `duplicate reviewed module name: ${module.name}`);
      moduleNames.add(module.name);
      assert(module.notice_in_module === true,
        `RFC ${candidate.rfc} ${module.name} lacks its file-specific notice`);
      activeSameNameAlternates += assertActiveVariant(module, candidate, catalogById, crossCheckBaseline);
      moduleDefinitions += 1;
    }

    if (candidate.decision === ACCEPTED) {
      accepted += 1;
      assert(candidate.controlling_basis === "embedded-module-bsd-3-clause",
        `RFC ${candidate.rfc} accepted without a file-specific controlling basis`);
      assert(candidate.decision_reason === "exact-rfc-embeds-complete-bsd-3-clause-in-each-listed-module",
        `RFC ${candidate.rfc} accepted for an unsupported reason`);
      assert(candidate.activation_state === "not-active",
        `RFC ${candidate.rfc} review must not activate content`);
    } else {
      if (candidate.decision === "unknown") unknown += 1;
      if (candidate.decision === "rejected") rejected += 1;
      assert(candidate.activation_state === "quarantine",
        `RFC ${candidate.rfc} ${candidate.decision} decision must remain quarantined`);
      quarantined += 1;
    }
  }

  const computedCounts = {
    candidates: FIXED_RFC_UNIVERSE.length,
    module_definitions: moduleDefinitions,
    accepted_for_candidate_build: accepted,
    unknown,
    rejected,
    quarantined,
    active_from_this_review: 0,
    active_same_name_alternates: activeSameNameAlternates,
  };
  assert(JSON.stringify(document.counts) === JSON.stringify(computedCounts), "review counts drifted");
  assert(isSha256(document.manifest_sha256), "manifest_sha256 must be a lowercase SHA-256");
  assert(document.manifest_sha256 === reviewDigest(document), "manifest_sha256 does not match canonical review content");

  return {
    review_id: document.review_id,
    ...computedCounts,
    baseline_cross_checked: crossCheckBaseline,
    manifest_sha256: document.manifest_sha256,
  };
}

async function main() {
  const reviewPath = process.argv[2] ?? "docs/research/rights/legacy-rfc-review.json";
  const [document, catalog] = await Promise.all([
    readFile(reviewPath, "utf8").then(JSON.parse),
    readFile("data/mib-catalog.json", "utf8").then(JSON.parse),
  ]);
  console.log(JSON.stringify(validateLegacyRfcReview(document, { catalog }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`legacy RFC review validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
