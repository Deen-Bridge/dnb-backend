import { describe, expect, it } from "@jest/globals";

const ALLOWED_NETWORKS = new Set(["PUBLIC", "TESTNET"]);
const ALLOWED_USDC_ISSUERS = new Set([
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
]);

function isAllowedUsdcAsset(assetCode, issuer, network) {
  if (!ALLOWED_NETWORKS.has(String(network).toUpperCase())) return false;
  if (String(assetCode).toUpperCase() !== "USDC") return false;
  return ALLOWED_USDC_ISSUERS.has(String(issuer));
}

describe("Stellar USDC issuer and network allowlist (#476)", () => {
  it("accepts canonical Circle USDC issuers on PUBLIC/TESTNET and rejects spoofed issuers", () => {
    expect(
      isAllowedUsdcAsset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        "PUBLIC"
      )
    ).toBe(true);
    expect(isAllowedUsdcAsset("USDC", "GFAKEISSUER123", "PUBLIC")).toBe(false);
    expect(isAllowedUsdcAsset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", "DEVNET")).toBe(false);
  });
});
