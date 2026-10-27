import { describe, test, expect } from "@jest/globals";
import {
  auditArtifactText,
  summarizeRepositoryAudit,
} from "../src/security/polinRiderHistoryAudit.js";

describe("PolinRider repository history and PR audit (#474)", () => {
  test("reports clean result on benign configuration and source files", () => {
    const summary = summarizeRepositoryAudit({
      commitRange: "main~20..main",
      reviewedPrs: [470, 471, 472, 473],
      artifacts: [
        { ref: "main", filePath: "package.json", content: '{"name":"dnb-backend","scripts":{"test":"jest"}}' },
        { ref: "PR#473", filePath: ".github/workflows/ci.yml", content: "name: CI\non: [push]" },
      ],
    });
    expect(summary.status).toBe("clean");
    expect(summary.findings).toHaveLength(0);
    expect(summary.scannedCount).toBe(2);
  });

  test("flags obfuscated eval and folderOpen tasks without executing artifacts", () => {
    const res = auditArtifactText({
      ref: "suspect-sha",
      filePath: ".vscode/tasks.json",
      content: '{"runOn": "folderOpen", "command": "eval(Buffer.from(\"aGVsbG8=\", \"base64\"))"}',
    });
    expect(res.clean).toBe(false);
    expect(res.findings.length).toBeGreaterThanOrEqual(1);
    expect(res.findings[0].filePath).toBe(".vscode/tasks.json");
  });
});
