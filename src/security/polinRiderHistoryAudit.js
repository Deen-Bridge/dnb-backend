/**
 * Non-executing PolinRider indicator audit across repository history and PR diffs (#474).
 */

export const POLINRIDER_SIGNATURES = Object.freeze([
  { id: "PR-01", pattern: /eval\s*\(\s*Buffer\.from\(/i, description: "Obfuscated Buffer eval payload" },
  { id: "PR-02", pattern: /tasks\.json[\s\S]*runOn["']?\s*:\s*["']folderOpen["']/i, description: "VSCode folderOpen auto-execution task" },
  { id: "PR-03", pattern: /\.(ttf|otf|woff2?)\b.*\b(node|sh|bash|powershell)\b/i, description: "Executable invocation disguised as font asset" },
  { id: "PR-04", pattern: /preinstall|postinstall.*curl\s+https?:\/\//i, description: "Suspicious lifecycle network fetch" },
]);

export function auditArtifactText({ ref, filePath, content }) {
  if (!ref || !filePath || typeof content !== "string") {
    throw new Error("ref, filePath, and string content are required for PolinRider audit");
  }
  const findings = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const sig of POLINRIDER_SIGNATURES) {
      if (sig.pattern.test(line)) {
        findings.push({
          ref,
          filePath,
          line: index + 1,
          signatureId: sig.id,
          description: sig.description,
        });
      }
    }
  });
  return {
    ref,
    filePath,
    clean: findings.length === 0,
    findings,
  };
}

export function summarizeRepositoryAudit({ commitRange, reviewedPrs, artifacts }) {
  if (!commitRange || !Array.isArray(reviewedPrs) || !Array.isArray(artifacts)) {
    throw new Error("commitRange, reviewedPrs, and artifacts array are required");
  }
  const results = artifacts.map((item) => auditArtifactText(item));
  const allFindings = results.flatMap((r) => r.findings);
  return {
    commitRange,
    reviewedPrs: [...reviewedPrs],
    scannedCount: results.length,
    status: allFindings.length === 0 ? "clean" : "indicators_detected",
    findings: allFindings,
  };
}
