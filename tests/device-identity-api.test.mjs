import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createPhase0ApiMock } from "../scripts/phase0-api-mock.mjs";
import {
  MAX_IDENTITY_BODY_BYTES,
  MAX_IDENTITY_MODEL_LENGTH,
  MAX_IDENTITY_RESULTS,
  MAX_IDENTITY_SYS_DESCR_LENGTH,
  MAX_OID_LENGTH
} from "../src/api.mjs";
import { DATA_RELEASE, IDENTITY_PUBLICATION_STATE, IDENTITY_RELEASE, IDENTITY_SOURCES, IDENTITY_STATISTICS } from "../src/intelligence.mjs";

async function withServer(callback) {
  const server = createPhase0ApiMock();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function assess(base, signals, overrides = {}) {
  return fetch(`${base}/v1/device-identities:assess`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ data_release: DATA_RELEASE, identity_release: IDENTITY_RELEASE, signals, ...overrides })
  });
}

function nestedKeys(value) {
  if (Array.isArray(value)) return value.flatMap(nestedKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [key, ...nestedKeys(item)]);
}

test("identity assessment is release-bound, private, bounded, and charged four fair-use units", async () => {
  await withServer(async (base) => {
    const privateDescription = "Cisco IOS XE PRIVATE-INPUT-7f39c90e";
    const response = await assess(base, {
      sys_object_id: "1.3.6.1.4.1.9.1.2435",
      sys_descr: privateDescription
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("etag"), null);
    assert.equal(response.headers.get("ratelimit-remaining"), "116");
    const body = await response.json();
    assert.equal(body.data_release, DATA_RELEASE);
    assert.equal(body.identity_release, IDENTITY_RELEASE);
    assert.deepEqual(body.identity_publication, IDENTITY_PUBLICATION_STATE);
    assert.ok(body.assessment);
    assert.equal(body.assessment.enterprise_number, 9);
    assert.equal(body.assessment.organization_key, "Q173395");
    assert.equal(body.assessment.identity_status, "exact_model");
    assert.equal(body.assessment.model, "C9300-24T");
    assert.ok(body.assessment.candidates.length <= MAX_IDENTITY_RESULTS);
    assert.ok(body.assessment.conflicts.length <= MAX_IDENTITY_RESULTS);
    assert.equal(JSON.stringify(body).includes(privateDescription), false);
  });
});

test("data-release exposes the independent identity release and measured coverage", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/data-release`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.match(response.headers.get("etag"), /^"sha256-[A-Za-z0-9_-]{43}"$/);
    const body = await response.json();
    assert.equal(body.identity_release, IDENTITY_RELEASE);
    assert.deepEqual(body.identity_publication, IDENTITY_PUBLICATION_STATE);
    assert.deepEqual(body.identity_statistics, IDENTITY_STATISTICS);
    assert.deepEqual(body.identity_sources, IDENTITY_SOURCES);
    assert.equal(body.sys_object_id_count, IDENTITY_STATISTICS.sys_object_id_mappings);
    assert.equal(body.statistics.identity.identity_release, IDENTITY_RELEASE);
    assert.equal(body.statistics.identity.exact_models, IDENTITY_STATISTICS.exact_models);

    const revalidated = await fetch(`${base}/v1/data-release`, {
      headers: { "if-none-match": response.headers.get("etag") }
    });
    assert.equal(revalidated.status, 304);
    assert.equal(revalidated.headers.get("cache-control"), "no-cache");
  });
});

test("one-character sysDescr cannot corrupt the public assessment contract", async () => {
  await withServer(async (base) => {
    const response = await assess(base, { sys_descr: "a" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data_release, DATA_RELEASE);
    assert.equal(body.identity_release, IDENTITY_RELEASE);
    assert.deepEqual(body.identity_publication, IDENTITY_PUBLICATION_STATE);
    assert.equal(typeof body.assessment.identity_status, "string");
    assert.equal(Array.isArray(body.assessment.candidates), true);
    assert.equal(Array.isArray(body.assessment.conflicts), true);
    const keys = nestedKeys(body);
    assert.equal(keys.includes("signals"), false);
    assert.equal(keys.includes("sys_descr"), false);
    assert.equal(keys.includes("sysDescr"), false);
  });
});

test("identity assessment rejects unsupported methods and media types", async () => {
  await withServer(async (base) => {
    const method = await fetch(`${base}/v1/device-identities:assess`);
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "POST, OPTIONS");
    assert.equal(method.headers.get("cache-control"), "no-store");

    const media = await fetch(`${base}/v1/device-identities:assess`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}"
    });
    assert.equal(media.status, 415);
    assert.equal((await media.json()).type, "https://mibvendor.io/problems/unsupported-media-type");
  });
});

test("identity assessment rejects malformed, oversized, empty, and extra-key bodies", async () => {
  await withServer(async (base) => {
    const malformed = await fetch(`${base}/v1/device-identities:assess`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    assert.equal(malformed.status, 400);

    const oversized = await fetch(`${base}/v1/device-identities:assess`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signals: { sys_descr: "x".repeat(MAX_IDENTITY_BODY_BYTES) } })
    });
    assert.equal(oversized.status, 413);

    const empty = await assess(base, {});
    assert.equal(empty.status, 422);

    const extraTopLevel = await assess(base, { sys_object_id: "1.3.6.1.4.1.9" }, { raw_walk: "forbidden" });
    assert.equal(extraTopLevel.status, 422);

    const extraSignal = await assess(base, { sys_object_id: "1.3.6.1.4.1.9", serial_number: "forbidden" });
    assert.equal(extraSignal.status, 422);
  });
});

test("every identity signal enforces type and length bounds", async () => {
  await withServer(async (base) => {
    const invalidSignals = [
      { sys_object_id: ["1.3.6.1.4.1.9"] },
      { ent_physical_vendor_type: ["1.3.6.1.4.1.9"] },
      { ent_physical_model_name: ["C9300-24T"] },
      { sys_descr: ["Cisco IOS XE"] },
      { sys_object_id: "1.3.6.1.4.1.4294967296" },
      { ent_physical_vendor_type: "1.3.6.1.4.1.4294967296" },
      { sys_object_id: `1.${"1".repeat(MAX_OID_LENGTH)}` },
      { ent_physical_vendor_type: `1.${"1".repeat(MAX_OID_LENGTH)}` },
      { ent_physical_model_name: "x".repeat(MAX_IDENTITY_MODEL_LENGTH + 1) },
      { sys_descr: "x".repeat(MAX_IDENTITY_SYS_DESCR_LENGTH + 1) },
      { ent_physical_model_name: "  " },
      { sys_descr: "\t" }
    ];
    for (const signals of invalidSignals) {
      const response = await assess(base, signals);
      assert.equal(response.status, 422, JSON.stringify(Object.keys(signals)));
      assert.equal((await response.json()).type, "https://mibvendor.io/problems/invalid-identity-assessment");
    }
  });
});

test("identity assessment rejects unavailable MIB and identity releases separately", async () => {
  await withServer(async (base) => {
    const wrongData = await assess(base, { sys_object_id: "1.3.6.1.4.1.9" }, { data_release: "missing" });
    assert.equal(wrongData.status, 409);
    assert.equal((await wrongData.json()).type, "https://mibvendor.io/problems/data-release-unavailable");

    const wrongIdentity = await assess(base, { sys_object_id: "1.3.6.1.4.1.9" }, { identity_release: "missing" });
    assert.equal(wrongIdentity.status, 409);
    assert.equal((await wrongIdentity.json()).type, "https://mibvendor.io/problems/identity-release-unavailable");
  });
});

test("C9300 evidence is narrow and contradictory evidence remains explicit", async () => {
  await withServer(async (base) => {
    const exact = (await (await assess(base, { sys_object_id: "1.3.6.1.4.1.9.1.2435" })).json()).assessment;
    assert.equal(exact.identity_status, "exact_model");
    assert.equal(exact.firmware_scope, "not_established");
    assert.equal(exact.candidates[0].firmware_scope, "not_established");
    assert.equal(exact.model, "C9300-24T");

    const neighbor = (await (await assess(base, { sys_object_id: "1.3.6.1.4.1.9.1.2436" })).json()).assessment;
    assert.equal(neighbor.model, "C9300-24P");
    assert.notEqual(neighbor.model, "C9300-24T");

    const vendorOnly = (await (await assess(base, { sys_object_id: "1.3.6.1.4.1.9.999999" })).json()).assessment;
    assert.equal(vendorOnly.identity_status, "vendor_only");
    assert.equal(vendorOnly.firmware_scope, "not_established");
    assert.equal(vendorOnly.model, null);

    const registryOnlyWithModel = (await (await assess(base, {
      sys_object_id: "1.3.6.1.4.1.9.999999",
      ent_physical_model_name: "C9300-48P"
    })).json()).assessment;
    assert.equal(registryOnlyWithModel.identity_status, "vendor_only");
    assert.equal(registryOnlyWithModel.model, null);
    assert.equal(registryOnlyWithModel.product_family, null);

    const platform = (await (await assess(base, { sys_descr: "Cisco IOS XE Software" })).json()).assessment;
    assert.notEqual(platform.identity_status, "exact_model");
    assert.notEqual(platform.model, "C9300");

    const conflict = (await (await assess(base, {
      sys_object_id: "1.3.6.1.4.1.9.1.2435",
      ent_physical_model_name: "C9300-24P"
    })).json()).assessment;
    assert.equal(conflict.identity_status, "conflicting_evidence");
    assert.equal(conflict.firmware_scope, null);
    assert.equal(conflict.model, null);
    assert.ok(conflict.conflicts.length > 0);

    const corroborated = (await (await assess(base, {
      sys_object_id: "1.3.6.1.4.1.9.1.2494",
      ent_physical_model_name: "C9300-48P"
    })).json()).assessment;
    assert.equal(corroborated.identity_status, "exact_model");
    assert.equal(corroborated.model, "C9300-48P");
  });
});

test("sysObjectID response preserves legacy fields and adds direct correlation fields", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/sys-object-ids/1.3.6.1.4.1.9.1.2435`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.match(response.headers.get("etag"), /^"sha256-[A-Za-z0-9_-]{43}"$/);
    const body = await response.json();
    assert.equal(body.data_release, DATA_RELEASE);
    assert.equal(body.identity_release, IDENTITY_RELEASE);
    assert.deepEqual(body.identity_publication, IDENTITY_PUBLICATION_STATE);
    assert.equal(body.result.status, "resolved");
    assert.ok(Object.hasOwn(body.result, "enterprise"));
    assert.ok(Object.hasOwn(body.result, "match"));
    assert.equal(body.result.enterprise_number, 9);
    assert.equal(body.result.organization_key, "Q173395");
    assert.equal(body.result.organization_key_status, "reviewed");
    assert.equal(body.result.identity_status, "exact_model");
    assert.equal(body.result.firmware_scope, "not_established");
    assert.equal(body.result.match.firmware_scope, "not_established");
    assert.equal(body.result.identity_release, IDENTITY_RELEASE);
    assert.equal(body.result.identity_view, IDENTITY_PUBLICATION_STATE.identity_view);
    assert.deepEqual(body.result.publication_control, IDENTITY_PUBLICATION_STATE);
    assert.ok(body.result.assessment);

    const revalidated = await fetch(`${base}/v1/sys-object-ids/1.3.6.1.4.1.9.1.2435`, {
      headers: { "if-none-match": response.headers.get("etag") }
    });
    assert.equal(revalidated.status, 304);
    assert.equal(revalidated.headers.get("cache-control"), "no-cache");

    const unmappedOrganization = await (await fetch(`${base}/v1/sys-object-ids/1.3.6.1.4.1.8072.3.2.10`)).json();
    assert.equal(unmappedOrganization.result.enterprise_number, 8072);
    assert.equal(unmappedOrganization.result.organization_key, null);
    assert.equal(unmappedOrganization.result.organization_key_status, "not_available");
  });
});

test("RackTables exact definition response satisfies the public match contract without leaking source text", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/sys-object-ids/1.3.6.1.4.1.9.6.1.83.10.1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    const { match } = body.result;
    assert.equal(match.organization, "ciscoSystems");
    assert.equal(match.organization_name, "ciscoSystems");
    assert.equal(match.model, "SG 300-10");
    assert.equal(match.claim_scope, "open-source-project-device-definition");
    assert.equal(match.confidence, "medium");
    assert.equal(match.source_assignment_confidence, "high");
    assert.equal(match.firmware_scope, "not_established");
    assert.equal(match.provenance.artifact_rights, "GPL-2.0-only source; mibvendor-normalized definition");
    assert.equal(match.provenance.publication_mode, "definition-only");
    assert.equal(match.provenance.raw_download, false);
    assert.equal(JSON.stringify(body).includes("RJ-45"), false);
  });
});
