const fs = require("node:fs");

const spec = fs.readFileSync("openapi.yaml", "utf8");
if (!/^openapi:\s*3\.[01]\./m.test(spec)) throw new Error("OpenAPI 3.x document is required");

const operationIds = [...spec.matchAll(/^\s+operationId:\s*([A-Za-z0-9_.-]+)\s*$/gm)].map((match) => match[1]);
const duplicates = operationIds.filter((id, index) => operationIds.indexOf(id) !== index);
if (duplicates.length) throw new Error("Duplicate operationId: " + [...new Set(duplicates)].join(", "));

const missingOperationIds = [];
const pathBlocks = spec.split(/^  (?=\/)/m).slice(1);
for (const block of pathBlocks) {
  const path = block.match(/^([^\s:]+):/)?.[1];
  if (!path) continue;
  const operations = [...block.matchAll(/^\s{4}(get|post|put|patch|delete|head|options):/gm)];
  for (const operation of operations) {
    const start = operation.index;
    const next = block.slice(start).search(/\n\s{4}(get|post|put|patch|delete|head|options):/);
    const section = block.slice(start, next < 0 ? block.length : start + next);
    if (!/^\s{6}operationId:/m.test(section)) missingOperationIds.push(operation[1].toUpperCase() + " " + path);
    if (!/^\s{6}responses:/m.test(section)) throw new Error(operation[1].toUpperCase() + " " + path + " has no responses");
  }
}
if (missingOperationIds.length) console.warn("Legacy operations without operationId: " + missingOperationIds.length);
console.log("Validated " + operationIds.length + " OpenAPI operation IDs and response maps");
