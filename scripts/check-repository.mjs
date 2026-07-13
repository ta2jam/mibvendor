import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function walk(directory, ignored = new Set([".git", "node_modules", ".local", ".tools"])) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute, ignored));
    else files.push(absolute);
  }
  return files;
}

for (const required of [
  "LICENSE",
  "VERSION",
  "README.md",
  "docs/PHASE-0.md",
  "docs/PRODUCT.md",
  "prototype/index.html",
  "prototype/app.js",
  "prototype/core.mjs"
]) {
  if (!await exists(required)) failures.push(`Missing required file: ${required}`);
}

const version = (await readFile(path.join(root, "VERSION"), "utf8")).trim();
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.version !== version) {
  failures.push(`VERSION (${version}) and package.json (${packageJson.version}) differ`);
}

const allFiles = await walk(root);
for (const file of allFiles.filter((candidate) => candidate.endsWith(".json"))) {
  try {
    JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    failures.push(`Invalid JSON: ${path.relative(root, file)} (${error.message})`);
  }
}

const markdownFiles = allFiles.filter((file) => file.endsWith(".md"));
const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(markdownLinkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (!rawTarget || rawTarget.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) continue;
    const relativeTarget = decodeURIComponent(rawTarget.split("#", 1)[0]);
    const resolved = path.resolve(path.dirname(file), relativeTarget);
    if (!await exists(path.relative(root, resolved))) {
      failures.push(`Broken local link in ${path.relative(root, file)}: ${rawTarget}`);
    }
  }
}

const disallowedExtensions = new Set([".mib", ".my", ".smiv1", ".smiv2"]);
for (const file of allFiles) {
  if (!disallowedExtensions.has(path.extname(file).toLowerCase())) continue;
  const relative = path.relative(root, file);
  const allowedFixture = relative.startsWith(path.join("experiments", "parser-bakeoff", "fixtures", "redistributable"))
    || (
      relative.startsWith(path.join("experiments", "parser-bakeoff", "corpus", "MIBVENDOR-"))
      && await exists(path.join("experiments", "parser-bakeoff", "corpus", "LICENSE.md"))
    );
  if (!allowedFixture) failures.push(`Unreviewed MIB-like file outside redistributable fixtures: ${relative}`);
}

const prototypeHtml = await readFile(path.join(root, "prototype", "index.html"), "utf8");
const prototypeApp = await readFile(path.join(root, "prototype", "app.js"), "utf8");
const htmlIds = new Set([...prototypeHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
for (const match of prototypeApp.matchAll(/querySelector\("#([^"]+)"\)/g)) {
  if (!htmlIds.has(match[1])) failures.push(`Prototype selector has no matching HTML id: #${match[1]}`);
}
if (!prototypeHtml.includes('<html lang="en">')) failures.push("Prototype must declare its document language");
if (!prototypeHtml.includes('name="viewport"')) failures.push("Prototype must include a responsive viewport");

if (failures.length) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Repository checks passed (${allFiles.length} files, ${markdownFiles.length} Markdown documents).`);
}
