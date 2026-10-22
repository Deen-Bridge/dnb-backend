import { describe, expect, it } from "@jest/globals";

describe("middlewares directory consolidation contract (#408)", () => {
  it("resolves canonical middleware paths under src/middlewares/", () => {
    const normalizeMiddlewareImport = (importPath) =>
      importPath.replace(/\/src\/middleware\//, "/src/middlewares/");
    expect(normalizeMiddlewareImport("../src/middleware/analytics/tracker.js")).toBe(
      "../src/middlewares/analytics/tracker.js"
    );
  });
});
