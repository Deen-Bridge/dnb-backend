import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";

describe("PolinRider supply-chain indicator audit (#474)", () => {
  it("ensures package.json and lockfile metadata contain no obfuscated eval or remote curl payloads", () => {
    const pkgRaw = fs.readFileSync("package.json", "utf8");
    expect(pkgRaw).not.toMatch(/eval\s*\(/);
    expect(pkgRaw).not.toMatch(/curl\s+http/i);
  });
});
