import { once } from "node:events";

import { createMibvendorServer } from "../server.mjs";

const server = createMibvendorServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
global.gc?.();

const baselineRssBytes = process.memoryUsage().rss;
let observedRssBytes = baselineRssBytes;
const sampler = setInterval(() => {
  observedRssBytes = Math.max(observedRssBytes, process.memoryUsage().rss);
}, 2);

process.send?.({
  type: "ready",
  port: server.address().port,
  baseline_rss_bytes: baselineRssBytes
});

process.on("message", async (message) => {
  if (message?.type === "measure") {
    const currentRssBytes = process.memoryUsage().rss;
    observedRssBytes = Math.max(observedRssBytes, currentRssBytes);
    process.send?.({
      type: "measurement",
      current_rss_bytes: currentRssBytes,
      observed_rss_bytes: observedRssBytes,
      process_lifetime_high_water_rss_bytes: process.resourceUsage().maxRSS * 1024
    });
    return;
  }
  if (message?.type === "shutdown") {
    clearInterval(sampler);
    server.close();
    await once(server, "close");
    process.disconnect?.();
  }
});
