import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createMibvendorServer } from "../server.mjs";

async function withServer(callback) {
  const server = createMibvendorServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("production server exposes UI, health, version, OpenAPI, and API on one origin", async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html/);
    assert.match(await page.text(), /MIB context without the maze/);

    assert.equal(await (await fetch(`${base}/healthz`)).text(), "ok\n");
    const version = await (await fetch(`${base}/version`)).json();
    assert.equal(version.schema_version, 1);
    assert.equal(version.data_release, "rights-cleared-2026-07-14.1");

    const specification = await (await fetch(`${base}/openapi.json`)).json();
    assert.equal(specification["x-mibvendor-status"], "public-alpha");

    const enterprise = await fetch(`${base}/v1/enterprises/8072`);
    assert.equal(enterprise.status, 200);
    assert.equal(enterprise.headers.get("access-control-allow-origin"), "*");
    assert.equal((await enterprise.json()).enterprise.organization, "net-snmp");

    const module = await fetch(`${base}/v1/modules/BFD-STD-MIB`);
    assert.equal(module.status, 200);
    assert.equal((await module.json()).module.raw_download, true);

    const raw = await fetch(`${base}/v1/modules/BFD-STD-MIB/raw`);
    assert.equal(raw.status, 200);
    assert.match(raw.headers.get("content-disposition"), /BFD-STD-MIB\.mib/);
  });
});

test("static server rejects traversal and unsupported methods", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/.release.json`)).status, 404);
    assert.equal((await fetch(`${base}/..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${base}/app.js`, { method: "POST" })).status, 405);
  });
});

test("malformed percent-encoded paths fail without terminating the server", async () => {
  await withServer(async (base) => {
    const malformed = await fetch(`${base}/v1/modules/%`);
    assert.equal(malformed.status, 400);
    assert.equal(await malformed.text(), "Bad request\n");

    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "ok\n");
  });
});

test("public API exposes rate limit headers and CORS preflight", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/data-release`);
    assert.equal(response.headers.get("ratelimit-limit"), "120");
    assert.equal(response.headers.get("ratelimit-remaining"), "119");

    const preflight = await fetch(`${base}/v1/resolve:batch`, { method: "OPTIONS" });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  });
});
