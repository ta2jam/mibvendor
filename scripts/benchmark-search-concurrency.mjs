import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const requestCount = Number.parseInt(process.env.SEARCH_BENCHMARK_CONCURRENCY ?? "40", 10);
const rssLimitBytes = Number.parseInt(process.env.SEARCH_BENCHMARK_RSS_LIMIT_BYTES ?? String(640 * 1024 * 1024), 10);
if (!Number.isSafeInteger(requestCount) || requestCount < 1 || requestCount > 120) {
  throw new Error("SEARCH_BENCHMARK_CONCURRENCY must be an integer from 1 to 120");
}
if (!Number.isSafeInteger(rssLimitBytes) || rssLimitBytes < 1) {
  throw new Error("SEARCH_BENCHMARK_RSS_LIMIT_BYTES must be a positive integer");
}

function waitForMessage(child, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for search benchmark child message: ${type}`));
    }, 120_000);
    const onMessage = (message) => {
      if (message?.type !== type) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Search benchmark child exited before ${type}: code=${code} signal=${signal}`));
    };
    function cleanup() {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
    }
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

const child = fork(fileURLToPath(new URL("./search-benchmark-server.mjs", import.meta.url)), [], {
  execArgv: ["--expose-gc"],
  stdio: ["ignore", "ignore", "inherit", "ipc"]
});

let report;
try {
  const ready = await waitForMessage(child, "ready");
  const started = process.hrtime.bigint();
  const baseUrl = `http://127.0.0.1:${ready.port}`;
  const responses = await Promise.all(Array.from({ length: requestCount }, () =>
    fetch(`${baseUrl}/v1/search?q=mib`, { headers: { connection: "close" } })
  ));
  const payloads = await Promise.all(responses.map((response) => response.json()));
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;

  if (responses.some((response) => response.status !== 200)) {
    throw new Error(`Concurrent search returned HTTP ${responses.map((response) => response.status).join(",")}`);
  }
  if (payloads.some((payload) => !Array.isArray(payload.results) || payload.results.length > 20)) {
    throw new Error("Concurrent search violated the top-20 response bound");
  }

  const measurementPromise = waitForMessage(child, "measurement");
  child.send({ type: "measure" });
  const measurement = await measurementPromise;
  report = {
    schema_version: 1,
    requests: requestCount,
    query: "mib",
    successful_responses: responses.length,
    maximum_results_per_response: Math.max(...payloads.map((payload) => payload.results.length)),
    duration_ms: Number(durationMs.toFixed(3)),
    baseline_rss_bytes: ready.baseline_rss_bytes,
    loaded_rss_bytes: measurement.current_rss_bytes,
    observed_rss_bytes: measurement.observed_rss_bytes,
    observed_growth_bytes: Math.max(0, measurement.observed_rss_bytes - ready.baseline_rss_bytes),
    process_lifetime_high_water_rss_bytes: measurement.process_lifetime_high_water_rss_bytes,
    rss_limit_bytes: rssLimitBytes,
    within_rss_limit: Math.max(measurement.observed_rss_bytes, measurement.process_lifetime_high_water_rss_bytes) <= rssLimitBytes
  };
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exitPromise = once(child, "exit");
    child.send({ type: "shutdown" });
    await exitPromise;
  }
}

console.log(JSON.stringify(report));
if (!report.within_rss_limit) process.exitCode = 1;
