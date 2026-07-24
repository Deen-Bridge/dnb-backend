import { jest } from "@jest/globals";
import { validateEnv } from "./validateEnv.js";

describe("validateEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      MONGO_URI: "mongodb://localhost:27017/test",
      JWT_SECRET: "test-secret-key-for-ci-minimum-32-chars",
      NODE_ENV: "test",
      PORT: "5000",
    };
    // Ensure new vars are unset
    delete process.env.HORIZON_URLS;
    delete process.env.HORIZON_TIMEOUT_MS;
    delete process.env.HORIZON_MAX_RETRIES;
    delete process.env.HORIZON_CB_THRESHOLD;
    delete process.env.HORIZON_CB_COOLDOWN_MS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should derive testnet default endpoint when STELLAR_NETWORK is unset or testnet", () => {
    delete process.env.STELLAR_NETWORK;
    validateEnv();
    expect(process.env.HORIZON_URLS).toBe("https://horizon-testnet.stellar.org");
    expect(process.env.HORIZON_TIMEOUT_MS).toBe("10000");
    expect(process.env.HORIZON_MAX_RETRIES).toBe("3");
    expect(process.env.HORIZON_CB_THRESHOLD).toBe("5");
    expect(process.env.HORIZON_CB_COOLDOWN_MS).toBe("30000");
  });

  it("should derive mainnet default endpoint when STELLAR_NETWORK is mainnet", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    validateEnv();
    expect(process.env.HORIZON_URLS).toBe("https://horizon.stellar.org");
  });

  it("should preserve explicitly set Horizon values", () => {
    process.env.HORIZON_URLS = "https://custom.stellar.org";
    process.env.HORIZON_TIMEOUT_MS = "5000";
    process.env.HORIZON_MAX_RETRIES = "1";
    process.env.HORIZON_CB_THRESHOLD = "10";
    process.env.HORIZON_CB_COOLDOWN_MS = "10000";
    validateEnv();
    expect(process.env.HORIZON_URLS).toBe("https://custom.stellar.org");
    expect(process.env.HORIZON_TIMEOUT_MS).toBe("5000");
    expect(process.env.HORIZON_MAX_RETRIES).toBe("1");
    expect(process.env.HORIZON_CB_THRESHOLD).toBe("10");
    expect(process.env.HORIZON_CB_COOLDOWN_MS).toBe("10000");
  });
});
