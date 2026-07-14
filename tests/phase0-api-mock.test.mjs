import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import {
  DATA_RELEASE,
  MAX_BODY_BYTES,
  MAX_BATCH_SIZE,
  createPhase0ApiMock
} from "../scripts/phase0-api-mock.mjs";

async function withServer(callback) {
  const server = createPhase0ApiMock();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("batch resolution preserves order, duplicates, instances, and unknown state", async () => {
  await withServer(async (base) => {
    const oids = [
      "1.3.6.1.2.1.2.2.1.8.7",
      "1.3.6.1.4.1.999999.1.0",
      "1.3.6.1.2.1.2.2.1.8.7"
    ];
    const response = await fetch(`${base}/v1/resolve:batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oids })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data_release, DATA_RELEASE);
    assert.deepEqual(body.results.map((result) => result.input), oids);
    assert.equal(body.results[0].object.symbol, "ifOperStatus");
    assert.deepEqual(body.results[0].instance_suffix, [7]);
    assert.equal(body.results[1].status, "not_found");
    assert.equal(body.results[2].status, "resolved");
  });
});

test("search and exact object responses expose release and provenance", async () => {
  await withServer(async (base) => {
    const searchResponse = await fetch(`${base}/v1/search?q=interface%20status`);
    const search = await searchResponse.json();
    assert.equal(search.results[0].symbol, "ifOperStatus");
    assert.equal(search.results[0].provenance.rights_tier, "Q");
    assert.equal(search.results[0].provenance.publication_status, "prototype_only");
    assert.deepEqual(search.results[0].provenance.scopes, []);

    const objectResponse = await fetch(`${base}/v1/objects/if-mib--ifoperstatus`);
    const object = await objectResponse.json();
    assert.equal(object.data_release, DATA_RELEASE);
    assert.equal(object.object.oid, "1.3.6.1.2.1.2.2.1.8");
  });
});

test("oversized batches return stable problem details", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/resolve:batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oids: Array.from({ length: MAX_BATCH_SIZE + 1 }, () => "1.3.6.1") })
    });
    const problem = await response.json();
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("content-type"), "application/problem+json");
    assert.equal(problem.type, "https://mibvendor.io/problems/batch-too-large");
  });
});

test("release changes remain explicitly synthetic and optional", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/releases/${DATA_RELEASE}/changes?since=older`);
    const body = await response.json();
    assert.deepEqual(body.changes, []);
    assert.match(body.note, /unvalidated/i);
  });
});

test("request bodies over the documented byte cap are rejected", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/resolve:batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oids: ["1".repeat(MAX_BODY_BYTES)] })
    });
    const problem = await response.json();
    assert.equal(response.status, 413);
    assert.equal(problem.type, "https://mibvendor.io/problems/body-too-large");
  });
});
