import { describe, test, expect } from "@jest/globals";
import { auditWorkflowTrustBoundary } from "../src/security/workflowTrustBoundaryAuditor.js";

describe("Prevent privileged workflows from executing untrusted PR code (#483)", () => {
  test("approves auto-merge workflow checking out only default_branch", () => {
    const trustedYaml = `
name: Auto-merge
on:
  pull_request_target:
    branches: [main]
jobs:
  merge:
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v5
        with:
          ref: \${{ github.event.repository.default_branch }}
`;
    const res = auditWorkflowTrustBoundary({
      workflowName: "auto-merge.yml",
      content: trustedYaml,
    });
    expect(res.safe).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  test("flags pull_request_target workflow that checks out pull_request.head.sha", () => {
    const unsafeYaml = `
on:
  pull_request_target:
jobs:
  build:
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v5
        with:
          ref: \${{ github.event.pull_request.head.sha }}
`;
    const res = auditWorkflowTrustBoundary({
      workflowName: "unsafe.yml",
      content: unsafeYaml,
    });
    expect(res.safe).toBe(false);
    expect(res.violations.length).toBeGreaterThanOrEqual(1);
  });
});
