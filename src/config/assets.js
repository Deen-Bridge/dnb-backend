// config/assets.js
//
// Network-aware asset registry. USDC stays the default so existing
// USDC-only flows (and existing Transaction rows with no currency set)
// keep working unchanged. Issuer addresses below are Circle's official
// EURC issuers (verified against developers.circle.com); XLM is native
// and has no issuer.

const REGISTRY = {
  testnet: {
    USDC: {
      code: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      decimals: 7,
      displayName: "USD Coin",
      isDefault: true,
    },
    EURC: {
      code: "EURC",
      issuer: "GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO",
      decimals: 7,
      displayName: "Euro Coin",
      isDefault: false,
    },
    XLM: {
      code: "XLM",
      issuer: null,
      decimals: 7,
      displayName: "Stellar Lumens",
      isDefault: false,
    },
  },
  mainnet: {
    USDC: {
      code: "USDC",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      decimals: 7,
      displayName: "USD Coin",
      isDefault: true,
    },
    EURC: {
      code: "EURC",
      issuer: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
      decimals: 7,
      displayName: "Euro Coin",
      isDefault: false,
    },
    XLM: {
      code: "XLM",
      issuer: null,
      decimals: 7,
      displayName: "Stellar Lumens",
      isDefault: false,
    },
  },
};

const NETWORK = process.env.STELLAR_NETWORK || "testnet";

export const getRegistry = (network = NETWORK) => {
  const registry = REGISTRY[network];
  if (!registry) {
    throw new Error(`Unknown Stellar network: ${network}`);
  }
  return registry;
};

export const getAssetConfig = (code, network = NETWORK) => {
  const registry = getRegistry(network);
  return registry[code] || null;
};

export const getSupportedCodes = (network = NETWORK) =>
  Object.keys(getRegistry(network));

export const getDefaultAssetCode = (network = NETWORK) => {
  const registry = getRegistry(network);
  const entry = Object.values(registry).find((a) => a.isDefault);
  return entry ? entry.code : "USDC";
};

export const isAssetSupported = (code, network = NETWORK) =>
  !!getAssetConfig(code, network);

export { REGISTRY };