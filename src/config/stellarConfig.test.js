import { jest } from "@jest/globals";

// Mock the asset registry so the issuer-mismatch validation path can be
// exercised (the real registry always agrees with the canonical constants,
// which is exactly what the cross-check is for).
const testnetIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const mainnetIssuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const getAssetConfig = jest.fn((code, network) =>
  code === "USDC"
    ? {
        code: "USDC",
        issuer: network === "mainnet" ? mainnetIssuer : testnetIssuer,
        isDefault: true,
      }
    : null
);

jest.unstable_mockModule("./assets.js", () => ({
  getAssetConfig,
  getDefaultAssetCode: jest.fn(() => "USDC"),
}));

const {
  resolveStellarNetwork,
  resolveStellarConfig,
  validateStellarConfig,
  USDC_ISSUERS,
} = await import("./stellar.js");

describe("stellar config resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.STELLAR_NETWORK;
    delete process.env.HORIZON_URLS;
    getAssetConfig.mockClear();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("defaults to testnet when STELLAR_NETWORK is unset", () => {
    expect(resolveStellarNetwork()).toBe("testnet");
    const config = resolveStellarConfig();
    expect(config.network).toBe("testnet");
    expect(config.networkPassphrase).toBe("Test SDF Network ; September 2015");
    expect(config.primaryHorizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(config.usdcIssuer).toBe(USDC_ISSUERS.testnet);
    expect(config.defaultAssetCode).toBe("USDC");
  });

  it("resolves the full mainnet config when STELLAR_NETWORK=mainnet", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    const config = resolveStellarConfig();
    expect(config.network).toBe("mainnet");
    expect(config.networkPassphrase).toBe(
      "Public Global Stellar Network ; September 2015"
    );
    expect(config.primaryHorizonUrl).toBe("https://horizon.stellar.org");
    expect(config.usdcIssuer).toBe(USDC_ISSUERS.mainnet);
    expect(config.usdcIssuer).not.toBe(USDC_ISSUERS.testnet);
  });

  it("treats 'public' as an alias for mainnet", () => {
    process.env.STELLAR_NETWORK = "public";
    const config = resolveStellarConfig();
    expect(config.network).toBe("mainnet");
    expect(config.networkPassphrase).toBe(
      "Public Global Stellar Network ; September 2015"
    );
    expect(config.primaryHorizonUrl).toBe("https://horizon.stellar.org");
  });

  it("accepts explicit HORIZON_URLS and trims/parses them", () => {
    process.env.HORIZON_URLS =
      " https://custom.stellar.org , https://mirror.stellar.org ";
    const config = resolveStellarConfig();
    expect(config.horizonUrls).toEqual([
      "https://custom.stellar.org",
      "https://mirror.stellar.org",
    ]);
    expect(config.primaryHorizonUrl).toBe("https://custom.stellar.org");
  });

  it("throws a descriptive error for an unknown network", () => {
    process.env.STELLAR_NETWORK = "devnet";
    expect(() => resolveStellarNetwork()).toThrow(
      /Invalid STELLAR_NETWORK "devnet"/
    );
    expect(() => resolveStellarConfig()).toThrow(
      /Invalid STELLAR_NETWORK "devnet"/
    );
  });

  it("accepts case-insensitive network values", () => {
    process.env.STELLAR_NETWORK = "MAINNET";
    expect(resolveStellarNetwork()).toBe("mainnet");
  });
});

describe("validateStellarConfig (fail-fast startup validation)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.STELLAR_NETWORK;
    delete process.env.HORIZON_URLS;
    getAssetConfig.mockClear();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("passes for a clean testnet configuration", () => {
    const result = validateStellarConfig();
    expect(result.valid).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("passes for a clean mainnet configuration", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    const result = validateStellarConfig();
    expect(result.valid).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("reports an invalid STELLAR_NETWORK value", () => {
    process.env.STELLAR_NETWORK = "devnet";
    const result = validateStellarConfig();
    expect(result.valid).toBe(false);
    expect(result.problems.join(" ")).toContain("Invalid STELLAR_NETWORK");
  });

  it("rejects a mainnet flag pointing at the testnet Horizon URL", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    process.env.HORIZON_URLS = "https://horizon-testnet.stellar.org";
    const result = validateStellarConfig();
    expect(result.valid).toBe(false);
    expect(result.problems.join(" ")).toContain("testnet");
    expect(result.problems.join(" ")).toContain("horizon-testnet.stellar.org");
  });

  it("rejects a testnet flag pointing at the mainnet Horizon URL", () => {
    process.env.HORIZON_URLS = "https://horizon.stellar.org";
    const result = validateStellarConfig();
    expect(result.valid).toBe(false);
    expect(result.problems.join(" ")).toContain("mainnet");
  });

  it("rejects a non-URL HORIZON_URLS entry", () => {
    process.env.HORIZON_URLS = "not-a-url,https://horizon-testnet.stellar.org";
    const result = validateStellarConfig();
    expect(result.valid).toBe(false);
    expect(result.problems.join(" ")).toContain("not-a-url");
  });

  it("allows custom (non-canonical) Horizon URLs on the right network", () => {
    process.env.HORIZON_URLS = "https://custom.stellar.org";
    const result = validateStellarConfig();
    expect(result.valid).toBe(true);
  });

  it("rejects a mainnet config whose resolved USDC issuer is the testnet issuer", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    // Simulate a corrupted/mismatched registry: mainnet network but testnet issuer.
    getAssetConfig.mockImplementation((code) =>
      code === "USDC"
        ? { code: "USDC", issuer: testnetIssuer, isDefault: true }
        : null
    );
    const result = validateStellarConfig();
    expect(result.valid).toBe(false);
    expect(result.problems.join(" ")).toContain("USDC issuer mismatch");
    expect(result.problems.join(" ")).toContain(testnetIssuer);
  });
});
