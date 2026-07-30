import { getRegistry, getAssetConfig, getSupportedCodes, getDefaultAssetCode, isAssetSupported } from "./assets.js";

describe("asset registry resolution", () => {
  it("resolves USDC as the default asset on testnet", () => {
    expect(getDefaultAssetCode("testnet")).toBe("USDC");
    const usdc = getAssetConfig("USDC", "testnet");
    expect(usdc.isDefault).toBe(true);
    expect(usdc.issuer).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
  });

  it("resolves USDC as the default asset on mainnet, with a different issuer than testnet", () => {
    expect(getDefaultAssetCode("mainnet")).toBe("USDC");
    const usdc = getAssetConfig("USDC", "mainnet");
    expect(usdc.issuer).toBe("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
    expect(usdc.issuer).not.toBe(getAssetConfig("USDC", "testnet").issuer);
  });

  it("resolves EURC with the correct issuer per network", () => {
    expect(getAssetConfig("EURC", "testnet").issuer).toBe("GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO");
    expect(getAssetConfig("EURC", "mainnet").issuer).toBe("GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2");
  });

  it("resolves XLM as native (no issuer) on both networks", () => {
    expect(getAssetConfig("XLM", "testnet").issuer).toBeNull();
    expect(getAssetConfig("XLM", "mainnet").issuer).toBeNull();
  });

  it("lists all supported codes per network", () => {
    expect(getSupportedCodes("testnet").sort()).toEqual(["EURC", "USDC", "XLM"]);
    expect(getSupportedCodes("mainnet").sort()).toEqual(["EURC", "USDC", "XLM"]);
  });

  it("reports unsupported codes as unsupported", () => {
    expect(isAssetSupported("DOGE", "testnet")).toBe(false);
    expect(getAssetConfig("DOGE", "testnet")).toBeNull();
  });

  it("throws a clear error for an unknown network", () => {
    expect(() => getRegistry("devnet")).toThrow("Unknown Stellar network: devnet");
  });
});