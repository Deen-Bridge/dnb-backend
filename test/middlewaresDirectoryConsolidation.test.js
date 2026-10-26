import { createRequire } from "node:module";
import { describe, expect, it } from "@jest/globals";

const require = createRequire(import.meta.url);

describe("middlewares directory consolidation contract (#408)", () => {
  it("resolves canonical analytics middleware modules under src/middlewares/analytics/", () => {
    const canonicalModules = [
      "../src/middlewares/analytics/activityTracker.js",
      "../src/middlewares/analytics/journey-tracker.js",
      "../src/middlewares/analytics/search-logger.js",
    ];

    for (const modulePath of canonicalModules) {
      expect(() => require.resolve(modulePath).replaceAll("\\", "/")).not.toThrow();
      expect(require.resolve(modulePath).replaceAll("\\", "/")).toContain("/src/middlewares/analytics/");
    }
  });
});
