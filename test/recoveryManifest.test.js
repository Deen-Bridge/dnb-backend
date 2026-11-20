import { jest } from "@jest/globals";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const verifier = path.resolve("scripts/verify-recovery-manifest.cjs");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function writeFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dnb-recovery-"));
  const artifactNames = [
    "mongodb",
    "redis",
    "object-storage",
    "queues",
    "configuration",
    "audit-evidence",
  ];
  const artifacts = artifactNames.map((component) => {
    const relativePath = `${component}.backup`;
    const contents = `fixture:${component}`;
    fs.writeFileSync(path.join(directory, relativePath), contents);
    return { component, path: relativePath, sha256: sha256(contents) };
  });
  const manifestPath = path.join(directory, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      version: 1,
      backupId: "test-backup",
      createdAt: new Date().toISOString(),
      rpoMinutes: 15,
      rtoMinutes: 60,
      encryption: { atRest: true, keyReference: "kms:test" },
      retention: { daily: 35, weekly: 12, monthly: 12 },
      artifacts,
    }),
  );
  return { directory, manifestPath };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("recovery manifest verifier", () => {
  it("accepts a complete, checksummed backup set", () => {
    const fixture = writeFixture();
    expect(execFileSync(process.execPath, [verifier, fixture.manifestPath], { encoding: "utf8" })).toContain(
      "Recovery manifest verified",
    );
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });

  it("rejects a changed artifact", () => {
    const fixture = writeFixture();
    fs.appendFileSync(path.join(fixture.directory, "mongodb.backup"), "tampered");
    expect(() => execFileSync(process.execPath, [verifier, fixture.manifestPath], { encoding: "utf8" })).toThrow();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  });
});
