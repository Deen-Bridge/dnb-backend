import { describe, test, expect } from "@jest/globals";
import {
  TRUSTED_STELLAR_NETWORKS,
  validatePaymentEndpointAssetConfig,
} from "../src/services/stellarUsdcAllowlist.js";

describe("Stellar USDC issuer and network allowlist (#476)", () => {
  test("accepts canonical testnet and mainnet USDC configurations", () => {
    const testnetRes = validatePaymentEndpointAssetConfig({
      network: "testnet",
      assetCode: "USDC",
      assetIssuer: TRUSTED_STELLAR_NETWORKS.testnet.usdcIssuers[0],
    });
    expect(testnetRes.allowed).toBe(true);
    expect(testnetRes.network).toBe("testnet");

    const mainnetRes = validatePaymentEndpointAssetConfig({
      network: "public",
      assetCode: "USDC",
      assetIssuer: TRUSTED_STELLAR_NETWORKS.public.usdcIssuers[0],
    });
    expect(mainnetRes.allowed).toBe(true);
    expect(mainnetRes.network).toBe("public");
  });

  test("fails closed on unknown issuer, mismatched network, or missing config", () => {
    const wrongIssuer = validatePaymentEndpointAssetConfig({
      network: "public",
      assetCode: "USDC",
      assetIssuer: TRUSTED_STELLAR_NETWORKS.testnet.usdcIssuers[0],
    });
    expect(wrongIssuer.allowed).toBe(false);
    expect(wrongIssuer.errorCode).toBe("UNTRUSTED_USDC_ISSUER");

    const missingNet = validatePaymentEndpointAssetConfig({
      network: "",
      assetCode: "USDC",
      assetIssuer: TRUSTED_STELLAR_NETWORKS.public.usdcIssuers[0],
    });
    expect(missingNet.allowed).toBe(false);
    expect(missingNet.errorCode).toBe("MISSING_NETWORK_CONFIG");
  });
});
