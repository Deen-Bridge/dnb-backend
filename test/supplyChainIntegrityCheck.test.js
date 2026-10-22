import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";

describe("non-executing supply-chain integrity check (#475)", () => {
  it("verifies package.json does not contain suspicious preinstall/postinstall lifecycle hooks", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const scripts = pkg.scripts || {};
    expect(scripts.preinstall).toBeUndefined();
    expect(scripts.postinstall).toBeUndefined();
  });
});
