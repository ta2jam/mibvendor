#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUEST_STATUSES = new Set(["not_sent", "sent", "responded", "closed"]);
const SCOPE_STATUSES = new Set(["unknown", "approved", "denied", "conditional"]);
const REQUIRED_SCOPES = new Set(["metadata_index", "rendered_text", "api_output", "raw_download", "bulk_export"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateRightsRequests(document) {
  assert(document?.schema_version === 1, "schema_version must be 1");
  assert(Array.isArray(document.scope_keys), "scope_keys must be an array");
  assert(new Set(document.scope_keys).size === REQUIRED_SCOPES.size
    && [...REQUIRED_SCOPES].every((scope) => document.scope_keys.includes(scope)), "scope_keys differ from the five governed scopes");
  assert(Array.isArray(document.requests), "requests must be an array");
  assert(document.requests.length === 10, "first wave must contain exactly 10 vendors");

  const requestIds = new Set();
  const sourceIds = new Set();
  let sent = 0;
  let approvedScopes = 0;
  for (const request of document.requests) {
    assert(typeof request.request_id === "string" && request.request_id, "request_id is required");
    assert(!requestIds.has(request.request_id), `duplicate request_id: ${request.request_id}`);
    requestIds.add(request.request_id);
    assert(typeof request.source_id === "string" && request.source_id, `${request.request_id} has no source_id`);
    assert(!sourceIds.has(request.source_id), `duplicate source_id: ${request.source_id}`);
    sourceIds.add(request.source_id);
    assert(typeof request.vendor === "string" && request.vendor, `${request.request_id} has no vendor`);
    assert(typeof request.product_scope === "string" && request.product_scope, `${request.request_id} has no product_scope`);
    assert(/^https:\/\//.test(request.contact_route), `${request.request_id} contact route must be HTTPS`);
    assert(REQUEST_STATUSES.has(request.status), `${request.request_id} has an invalid status`);
    assert(request.scopes && typeof request.scopes === "object", `${request.request_id} has no scopes`);
    assert(Object.keys(request.scopes).length === REQUIRED_SCOPES.size
      && [...REQUIRED_SCOPES].every((scope) => scope in request.scopes), `${request.request_id} does not track all five scopes`);

    for (const [scope, status] of Object.entries(request.scopes)) {
      assert(SCOPE_STATUSES.has(status), `${request.request_id} has invalid ${scope} status`);
      if (status !== "unknown") {
        assert(request.status === "responded" || request.status === "closed", `${request.request_id} has a scope decision without a response`);
        assert(typeof request.response_evidence === "string" && request.response_evidence, `${request.request_id} has a scope decision without response evidence`);
      }
      if (status === "approved" || status === "conditional") approvedScopes += 1;
    }

    if (request.status !== "not_sent") {
      sent += 1;
      assert(typeof request.recipient === "string" && request.recipient, `${request.request_id} is marked sent without a recipient`);
      assert(typeof request.sent_at === "string" && !Number.isNaN(Date.parse(request.sent_at)), `${request.request_id} is marked sent without a valid timestamp`);
    } else {
      assert(request.recipient === null && request.sent_at === null && request.response_evidence === null, `${request.request_id} has evidence fields despite not_sent status`);
      assert(Object.values(request.scopes).every((status) => status === "unknown"), `${request.request_id} has a decision despite not_sent status`);
    }
  }
  return { requests: document.requests.length, sent, approved_or_conditional_scopes: approvedScopes, vendor_path_approved: approvedScopes > 0 };
}

async function main() {
  const path = process.argv[2] ?? "docs/research/rights/permission-requests.json";
  const document = JSON.parse(await readFile(path, "utf8"));
  const status = validateRightsRequests(document);
  console.log(JSON.stringify(status, null, 2));
  if (!status.vendor_path_approved) console.log("vendor rights gate remains open; silence and unknown scope are not approval");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`rights request validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
