import { describe, test, expect } from "@jest/globals";
import {
  PINNED_TOOLCHAIN,
  computeWasmSha256,
  evaluateSorobanDeploymentGate,
} from "../src/services/sorobanArtifactDeploymentGate.js";

describe("Soroban reproducible artifact deployment gate (#480)", () => {
  test("blocks mainnet deployment on PRs or hash mismatch and allows verified releases", () => {
    const wasmHash = computeWasmSha256(Buffer.from("wasm-binary-v1"));
    const admin = "G" + "A".repeat(55);

    const blockedPr = evaluateSorobanDeploymentGate({
      network: "mainnet",
      isPullRequestEvent: true,
      protectedEnvironmentApproved: true,
      explicitMainnetConfirm: true,
      toolVersions: PINNED_TOOLCHAIN,
      expectedArtifactSha256: wasmHash,
      actualArtifactSha256: wasmHash,
      adminAccount: admin,
    });
    expect(blockedPr.allowed).toBe(false);
    expect(blockedPr.blockers).toContain("MAINNET_DEPLOY_FORBIDDEN_ON_PR");

    const approved = evaluateSorobanDeploymentGate({
      network: "mainnet",
      isPullRequestEvent: false,
      protectedEnvironmentApproved: true,
      explicitMainnetConfirm: true,
      toolVersions: PINNED_TOOLCHAIN,
      expectedArtifactSha256: wasmHash,
      actualArtifactSha256: wasmHash,
      adminAccount: admin,
    });
    expect(approved.allowed).toBe(true);
    expect(approved.blockers).toHaveLength(0);
  });
});
