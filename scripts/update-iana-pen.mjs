import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SOURCE_URL = "https://www.iana.org/assignments/enterprise-numbers/enterprise-numbers";
const OUTPUT_PATH = path.resolve("data/iana-private-enterprise-numbers.json");

function parseRegistry(text) {
  const updated = text.match(/\(last updated ([0-9-]+)\)/)?.[1];
  if (!updated) throw new Error("IANA registry update date is missing");

  const lines = text.split(/\r?\n/);
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\d+$/.test(lines[index])) continue;
    const number = Number(lines[index]);
    const organization = lines[index + 1]?.match(/^  (\S.*)$/)?.[1]?.trim();
    if (!Number.isSafeInteger(number) || number < 0 || !organization) {
      throw new Error(`Invalid registry record near line ${index + 1}`);
    }
    records.push([number, organization]);
  }

  if (records.length < 60_000) {
    throw new Error(`Registry is unexpectedly small: ${records.length}`);
  }
  for (let index = 1; index < records.length; index += 1) {
    if (records[index][0] <= records[index - 1][0]) {
      throw new Error(`Registry numbers are not strictly increasing at ${records[index][0]}`);
    }
  }
  return { updated, records };
}

const response = await fetch(SOURCE_URL, {
  headers: { "user-agent": "mibvendor-data-refresh/1.0 (+https://mibvendor.io)" }
});
if (!response.ok) throw new Error(`IANA registry request failed: HTTP ${response.status}`);
const source = await response.text();
const { updated, records } = parseRegistry(source);
const document = {
  schema_version: 1,
  source_url: SOURCE_URL,
  source_updated: updated,
  retrieved_at: new Date().toISOString(),
  source_sha256: createHash("sha256").update(source).digest("hex"),
  rights: "CC0-1.0",
  privacy: "Only PEN number and organization are retained; contact names and email addresses are discarded.",
  records
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(document)}\n`, "utf8");
console.log(`Wrote ${records.length} IANA PEN records updated ${updated} to ${OUTPUT_PATH}`);
