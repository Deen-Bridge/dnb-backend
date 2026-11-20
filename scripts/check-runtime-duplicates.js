import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const inventoryPath = path.join(root, "docs", "runtime-boundary.json");

const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const expectedDisposition = "typescript-staging-js-runtime";
const discovered = new Map();

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".ts")) {
      const relative = path.relative(sourceRoot, absolute).split(path.sep).join("/");
      const extension = path.extname(relative);
      const stem = relative.slice(0, -extension.length);
      const files = discovered.get(stem) || new Set();
      files.add(extension.slice(1));
      discovered.set(stem, files);
    }
  }
}

walk(sourceRoot);

const duplicateStems = [...discovered.entries()]
  .filter(([, extensions]) => extensions.has("js") && extensions.has("ts"))
  .map(([stem]) => stem)
  .sort();
const expected = Object.keys(inventory).sort();
const errors = [];

for (const stem of duplicateStems) {
  if (!Object.hasOwn(inventory, stem)) errors.push(`Undocumented JS/TS duplicate: src/${stem}.js and src/${stem}.ts`);
  else if (inventory[stem] !== expectedDisposition) {
    errors.push(`Invalid disposition for src/${stem}: ${inventory[stem]}`);
  }
}

for (const stem of expected) {
  const extensions = discovered.get(stem);
  if (!extensions || !extensions.has("js") || !extensions.has("ts")) {
    errors.push(`Stale runtime-boundary inventory entry: src/${stem}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Runtime boundary verified: ${duplicateStems.length} documented JS/TS staging pair(s); JavaScript is authoritative.`);
}
