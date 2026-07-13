#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [sourceId] = process.argv.slice(2);
const ownerName = process.env.MIBVENDOR_OWNER_NAME;
const ownerRole = process.env.MIBVENDOR_OWNER_ROLE;
const ownerEmail = process.env.MIBVENDOR_OWNER_EMAIL;
const entity = process.env.MIBVENDOR_ENTITY ?? "mibvendor";

if (!sourceId || !ownerName || !ownerRole || !ownerEmail) {
  console.error("usage: MIBVENDOR_OWNER_NAME=... MIBVENDOR_OWNER_ROLE=... MIBVENDOR_OWNER_EMAIL=... node scripts/render-rights-request.mjs <source_id>");
  process.exit(2);
}

const tracker = JSON.parse(await readFile("docs/research/rights/permission-requests.json", "utf8"));
const request = tracker.requests.find((entry) => entry.source_id === sourceId);
if (!request) {
  console.error(`unknown first-wave source_id: ${sourceId}`);
  process.exit(2);
}

process.stdout.write(`Subject: Permission request for ${request.product_scope} in mibvendor\n\n`);
process.stdout.write(`To ${request.vendor} Legal / Licensing Team,\n\n`);
process.stdout.write(`${entity} is developing a public MIB discovery service and JSON API. We request written permission covering the following independent uses of ${request.product_scope}:\n\n`);
process.stdout.write(`1. metadata_index — store and expose module names, symbols, numeric OIDs, revisions, dependency links, syntax summaries, and provenance;\n`);
process.stdout.write(`2. rendered_text — display descriptions and other human-readable excerpts;\n`);
process.stdout.write(`3. api_output — return the indexed and rendered information through a public or commercial API;\n`);
process.stdout.write(`4. raw_download — mirror original MIB files for individual download; and\n`);
process.stdout.write(`5. bulk_export — provide bulk datasets or machine-readable exports.\n\n`);
process.stdout.write(`Please state approved, denied, or conditional for each scope, including attribution, notice-retention, update, access, volume, and commercial-use conditions. Permission for one scope will not be treated as permission for another. Public download availability and silence will not be treated as approval.\n\n`);
process.stdout.write(`Requested source family: ${request.product_scope}\nTracking ID: ${request.request_id}\nContact route reviewed: ${request.contact_route}\n\n`);
process.stdout.write(`Regards,\n${ownerName}\n${ownerRole}\n${ownerEmail}\n`);
