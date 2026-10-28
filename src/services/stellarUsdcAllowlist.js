/**
 * Enforce an allowlist for USDC issuer and network on Stellar payment endpoints (#476).
 */

export const TRUSTED_STELLAR_NETWORKS = Object.freeze({
  testnet: Object.freeze({
    networkPassphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    usdcIssuers: Object.freeze(["GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"]),
  }),
  public: Object.freeze({
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    horizonUrl: "https://horizon.stellar.org",
    usdcIssuers: Object.freeze(["GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"]),
  }),
});

export function validatePaymentEndpointAssetConfig({
  network,
  assetCode,
  assetIssuer,
  horizonUrl,
  registry = TRUSTED_STELLAR_NETWORKS,
}) {
  if (!network || typeof network !== "string") {
    return { allowed: false, network: null, errorCode: "MISSING_NETWORK_CONFIG" };
  }
  const netKey = network.trim().toLowerCase();
  const netConfig = registry[netKey];
  if (!netConfig) {
    return { allowed: false, network: netKey, errorCode: "UNSUPPORTED_STELLAR_NETWORK" };
  }

  const code = String(assetCode || "").trim().toUpperCase();
  if (code !== "USDC") {
    return { allowed: false, network: netKey, errorCode: "UNSUPPORTED_ASSET_CODE" };
  }

  const issuer = String(assetIssuer || "").trim();
  if (!issuer || !netConfig.usdcIssuers.includes(issuer)) {
    return { allowed: false, network: netKey, errorCode: "UNTRUSTED_USDC_ISSUER" };
  }

  if (horizonUrl && horizonUrl.trim() !== netConfig.horizonUrl) {
    return { allowed: false, network: netKey, errorCode: "MISMATCHED_HORIZON_ENDPOINT" };
  }

  return {
    allowed: true,
    network: netKey,
    assetCode: "USDC",
    assetIssuer: issuer,
    horizonUrl: netConfig.horizonUrl,
    networkPassphrase: netConfig.networkPassphrase,
  };
}
