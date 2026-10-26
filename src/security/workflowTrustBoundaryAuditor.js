/**
 * Audit GitHub Actions workflows so privileged triggers never execute untrusted PR code (#483).
 */

export function auditWorkflowTrustBoundary({ workflowName, content }) {
  if (!workflowName || typeof content !== "string") {
    throw new Error("workflowName and string content are required");
  }
  const violations = [];
  const usesPrivilegedTrigger = /\b(pull_request_target|workflow_run)\s*:/i.test(content);
  const hasWritePermissions = /\b(contents|pull-requests|issues|packages)\s*:\s*write\b/i.test(content);
  const checksOutPrHead =
    /github\.event\.pull_request\.head\.(sha|ref)/i.test(content) ||
    /refs\/pull\/.*\/merge/i.test(content);

  if (usesPrivilegedTrigger && checksOutPrHead) {
    violations.push({
      rule: "UNTRUSTED_PR_CHECKOUT_IN_PRIVILEGED_WORKFLOW",
      detail: `${workflowName} checks out untrusted PR head under pull_request_target/workflow_run`,
    });
  }

  if (hasWritePermissions && checksOutPrHead) {
    violations.push({
      rule: "WRITE_TOKEN_EXPOSED_TO_PR_CODE",
      detail: `${workflowName} combines write permissions with untrusted PR checkout`,
    });
  }

  return {
    workflowName,
    usesPrivilegedTrigger,
    hasWritePermissions,
    safe: violations.length === 0,
    violations,
  };
}
