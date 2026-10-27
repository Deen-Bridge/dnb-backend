import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";

describe("dependency audit manifest verification (#396)", () => {
  it("verifies all production dependencies use explicit semver ranges rather than wildcard *", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    for (const [, version] of Object.entries(pkg.dependencies || {})) {
      expect(version).not.toBe("*");
    }
  });
});
