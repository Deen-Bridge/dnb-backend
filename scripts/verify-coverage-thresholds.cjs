const fs = require("node:fs");
const path = require("node:path");

const policyPath = path.resolve(__dirname, "..", ".github/coverage-thresholds.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const dimensions = ["lines", "statements", "functions", "branches"];

for (const scope of [{ name: "global", threshold: policy.global }, ...policy.critical]) {
  for (const dimension of dimensions) {
    const value = scope.threshold?.[dimension];
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error(`${scope.name} ${dimension} must be an integer between 0 and 100`);
    }
  }
}

for (const entry of policy.critical) {
  if (!entry.name || !entry.path) {
    throw new Error("Every critical coverage entry needs a name and path");
  }
}

console.log(
  `Coverage policy valid: ${policy.critical.length} critical paths, ` +
    `global line threshold ${policy.global.lines}%`
);
