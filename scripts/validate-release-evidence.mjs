import process from "node:process";

import { validateActiveReleaseEvidence } from "./lib/release-evidence.mjs";

const result = await validateActiveReleaseEvidence(process.cwd());
if (!result.ok) {
  for (const failure of result.failures) console.error(`ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  const summary = result.summary;
  console.log(`Release evidence passed: ${summary.release_id} (${summary.modules} modules, ${summary.objects} objects, ${summary.sources} sources; activated by ${summary.application_release}, consumed by ${summary.consumer_application_release}).`);
}
