import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateRightsRequests } from "../scripts/validate-rights-requests.mjs";

async function tracker() {
  return JSON.parse(await readFile("docs/research/rights/permission-requests.json", "utf8"));
}

test("first-wave tracker is complete and honestly open", async () => {
  const status = validateRightsRequests(await tracker());
  assert.deepEqual(status, { requests: 10, sent: 0, approved_or_conditional_scopes: 0, vendor_path_approved: false });
});

test("sent status requires recipient and timestamp", async () => {
  const document = await tracker();
  document.requests[0].status = "sent";
  assert.throws(() => validateRightsRequests(document), /without a recipient/);
});

test("scope approval requires response evidence", async () => {
  const document = await tracker();
  Object.assign(document.requests[0], { status: "responded", recipient: "vendor legal", sent_at: "2026-07-13T10:00:00Z" });
  document.requests[0].scopes.metadata_index = "approved";
  assert.throws(() => validateRightsRequests(document), /without response evidence/);
});
