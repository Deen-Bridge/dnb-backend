import fs from "node:fs";

const coveragePolicy = JSON.parse(
  fs.readFileSync(new URL("./.github/coverage-thresholds.json", import.meta.url), "utf8")
);

const coverageThreshold = { global: coveragePolicy.global };
for (const entry of coveragePolicy.critical) {
  coverageThreshold[entry.path] = entry.threshold;
}

export default {
  testEnvironment: "node",
  injectGlobals: true,
  transform: {},
  setupFiles: ["<rootDir>/test/jest.setup.cjs"],
  testMatch: ["<rootDir>/test/**/*.test.js"],
  testTimeout: 60000,
  collectCoverageFrom: ["src/**/*.js", "!src/**/index.js"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "text-summary", "lcov", "json-summary"],
  coverageThreshold,
};
