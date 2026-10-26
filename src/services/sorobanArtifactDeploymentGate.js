/**
 * Reproducible and reviewed Soroban WASM artifact deployment gate (#480).
 */

import crypto from "node:crypto";

export const PINNED_TOOLCHAIN = Object.freeze({
  rustVersion: "1.82.0",
  stellarCliVersion: "22.0.0",
});

export function computeWasmSha256(wasmBuffer) {
  return crypto.createHash("sha256").update(wasmBuffer).digest("hex");
}

export function evaluateSorobanDeploymentGate({
  network,
  isPullRequestEvent = false,
  protectedEnvironmentApproved = false,
  explicitMainnetConfirm = false,
  toolVersions,
  expectedArtifactSha256,
  actualArtifactSha256,
  adminAccount,
}) {
  const blockers = [];

  if (!toolVersions || toolVersions.rustVersion !== PINNED_TOOLCHAIN.rustVersion) {
    blockers.push("UNPINNED_RUST_TOOLCHAIN");
  }
  if (!toolVersions || toolVersions.stellarCliVersion !== PINNED_TOOLCHAIN.stellarCliVersion) {
    blockers.push("UNPINNED_STELLAR_CLI_VERSION");
  }
  if (!expectedArtifactSha256 || expectedArtifactSha256 !== actualArtifactSha256) {
    blockers.push("ARTIFACT_HASH_MISMATCH");
  }
  if (!adminAccount || !String(adminAccount).startsWith("G") || String(adminAccount).length !== 56) {
    blockers.push("INVALID_ADMIN_PUBLIC_KEY");
  }

  if (network === "mainnet") {
    if (isPullRequestEvent) {
      blockers.push("MAINNET_DEPLOY_FORBIDDEN_ON_PR");
    }
    if (!protectedEnvironmentApproved || !explicitMainnetConfirm) {
      blockers.push("MAINNET_APPROVAL_REQUIRED");
    }
  }

  return {
    allowed: blockers.length === 0,
    network,
    artifactSha256: actualArtifactSha256,
    blockers,
  };
}
