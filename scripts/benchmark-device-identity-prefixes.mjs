import { performance } from "node:perf_hooks";
import process from "node:process";

import { IDENTITY_RELEASE, IDENTITY_STATISTICS, lookupSysObjectId } from "../src/intelligence.mjs";

const iterationsPerSample = Number.parseInt(process.argv[2] ?? "20000", 10);
if (!Number.isSafeInteger(iterationsPerSample) || iterationsPerSample < 1_000 || iterationsPerSample > 1_000_000) {
  throw new Error("iterations per sample must be an integer from 1000 through 1000000");
}

const sampleCount = 7;
const warmupIterations = Math.min(5_000, iterationsPerSample);
const depths = [8, 16, 32, 64];
const baseArcs = [1, 3, 6, 1, 4, 1, 30065, 1];
const expectedPrefix = baseArcs.join(".");

function oidPool(depth) {
  if (depth < baseArcs.length) throw new Error(`depth ${depth} is below the benchmark prefix depth`);
  return Array.from({ length: 64 }, (_, poolIndex) => {
    const suffix = Array.from(
      { length: depth - baseArcs.length },
      (_, suffixIndex) => ((poolIndex * 17 + suffixIndex * 13) % 127) + 1,
    );
    return [...baseArcs, ...suffix].join(".");
  });
}

function percentile(sorted, percentileValue) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return {
    rss_bytes: memory.rss,
    heap_used_bytes: memory.heapUsed,
    heap_total_bytes: memory.heapTotal,
    external_bytes: memory.external,
  };
}

function execute(pool, count) {
  let checksum = 0;
  for (let index = 0; index < count; index += 1) {
    const result = lookupSysObjectId(pool[index % pool.length]);
    if (result.status !== "resolved"
      || result.match?.match_type !== "prefix"
      || result.match?.oid !== expectedPrefix
      || result.match?.platform !== "arista_eos") {
      throw new Error(`prefix lookup contract failed for ${pool[index % pool.length]}`);
    }
    checksum += result.assessment.candidates.length + result.match.oid.length;
  }
  return checksum;
}

const before = memorySnapshot();
const cpuBefore = process.cpuUsage();
const measurements = [];
let checksum = 0;

for (const depth of depths) {
  const pool = oidPool(depth);
  checksum += execute(pool, warmupIterations);
  const nanosecondsPerLookup = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = performance.now();
    checksum += execute(pool, iterationsPerSample);
    const elapsedMilliseconds = performance.now() - started;
    nanosecondsPerLookup.push((elapsedMilliseconds * 1_000_000) / iterationsPerSample);
  }
  nanosecondsPerLookup.sort((left, right) => left - right);
  const p50 = percentile(nanosecondsPerLookup, 0.5);
  const p95 = percentile(nanosecondsPerLookup, 0.95);
  measurements.push({
    oid_depth_arcs: depth,
    prefix_map_probes_per_lookup: depth - 7,
    p50_batch_sample_ns_per_lookup: Math.round(p50),
    p95_batch_sample_ns_per_lookup: Math.round(p95),
    p50_lookups_per_second: Math.round(1_000_000_000 / p50),
  });
}

const after = memorySnapshot();
const cpu = process.cpuUsage(cpuBefore);
const output = {
  schema_version: 1,
  benchmark: "device-identity-project-prefix-lookup",
  generated_at: new Date().toISOString(),
  identity_release: IDENTITY_RELEASE,
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  workload: {
    execution: "single-process warm in-memory sequential public lookup; excludes HTTP and JSON serialization",
    matched_prefix: expectedPrefix,
    expected_platform: "arista_eos",
    pool_size_per_depth: 64,
    depths_arcs: depths,
    warmup_iterations_per_depth: warmupIterations,
    samples_per_depth: sampleCount,
    iterations_per_sample: iterationsPerSample,
  },
  index_counts: {
    exact_sys_object_id_mappings: IDENTITY_STATISTICS.sys_object_id_mappings,
    project_platform_prefixes: IDENTITY_STATISTICS.project_platform_prefixes,
  },
  complexity: {
    prefix_map_probes: "O(A), at most A-7 probes for an enterprise sysObjectID with A arcs",
    current_prefix_key_materialization: "O(A^2) total character work in the worst case because every descending prefix is slice/join materialized and hashed for Map lookup",
    prefix_index_memory: "O(P) for P project prefixes; the complete identity engine also retains exact claims, definitions, and fixtures",
    transient_lookup_memory: "O(A) live parsed/prefix state, with O(A^2) transient string allocation over the lookup",
  },
  measurements,
  process: {
    before,
    after,
    peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
    user_cpu_microseconds: cpu.user,
    system_cpu_microseconds: cpu.system,
  },
  checksum,
  energy: {
    status: "not_measured",
    note: "Elapsed time and CPU time are not an energy measurement.",
  },
  caveats: [
    "These are batch-sample throughput measurements, not per-request latency percentiles.",
    "Results are machine- and runtime-specific and do not establish a production SLO.",
    "The benchmark exercises the full public identity lookup result construction, not an isolated Map.get call.",
  ],
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
