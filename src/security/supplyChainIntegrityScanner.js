/**
 * Non-executing supply-chain integrity check for backend CI (#475).
 */

const ALLOWED_LIFECYCLE_SCRIPTS = new Set(["test", "start", "dev", "build", "lint"]);

export function scanPackageManifestText(rawJson, { allowedSuppressions = [] } = {}) {
  if (typeof rawJson !== "string" || !rawJson.trim()) {
    throw new Error("rawJson must be a non-empty string");
  }
  const suppressed = new Set(allowedSuppressions);
  const findings = [];

  const trimmed = rawJson.trim();
  if (!trimmed.endsWith("}")) {
    findings.push({
      rule: "CONFIG_TRAILING_PAYLOAD",
      evidence: "Content detected after closing brace of structured JSON manifest",
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    findings.push({
      rule: "MALFORMED_JSON_MANIFEST",
      evidence: "Manifest is not valid JSON",
    });
    return { passed: false, findings };
  }

  const scripts = parsed.scripts || {};
  for (const [hook, cmd] of Object.entries(scripts)) {
    if (
      ["preinstall", "install", "postinstall", "prepare"].includes(hook) &&
      !suppressed.has(`lifecycle:${hook}`)
    ) {
      findings.push({
        rule: "UNEXPECTED_INSTALL_LIFECYCLE_HOOK",
        evidence: `${hook}: ${String(cmd).slice(0, 120)}`,
      });
    }
    if (!ALLOWED_LIFECYCLE_SCRIPTS.has(hook) && /(?:curl|wget|nc|bash\s+-c|powershell)/i.test(String(cmd))) {
      findings.push({
        rule: "SUSPICIOUS_SCRIPT_SHELL_COMMAND",
        evidence: `${hook}: ${String(cmd).slice(0, 120)}`,
      });
    }
  }

  return {
    passed: findings.length === 0,
    findings,
  };
}
