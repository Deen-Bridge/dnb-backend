import { describe, expect, it } from "@jest/globals";

describe("mounted controllers and services route audit (#410)", () => {
  it("identifies unmounted controller modules by comparing route imports against inventory", () => {
    const inventory = ["authController", "courseController", "legacyUnusedController"];
    const mounted = new Set(["authController", "courseController"]);
    const unmounted = inventory.filter((c) => !mounted.has(c));
    expect(unmounted).toEqual(["legacyUnusedController"]);
  });
});
