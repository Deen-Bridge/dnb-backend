import { configurationFingerprint, validateProductionConfiguration } from "./productionConfig.js";

describe("production configuration validation", () => {
  const base = {
    NODE_ENV: "production",
    JWT_SECRET: "a".repeat(40),
    WEBHOOK_SECRET_ENCRYPTION_KEY: "b".repeat(40),
    AI_SERVICE_KEYS: "key-a",
    CORS_ALLOWED_ORIGINS: "https://deenbridge.example",
    HORIZON_URLS: "https://horizon.stellar.org",
    STELLAR_NETWORK: "mainnet",
    EMAIL_FROM: "ops@deenbridge.example",
  };

  it("rejects placeholders, wildcard origins, and mixed provider settings", () => {
    const problems = validateProductionConfiguration({ ...base, JWT_SECRET: "change-me", CORS_ALLOWED_ORIGINS: "*", STELLAR_NETWORK: "mainnet", HORIZON_URLS: "https://horizon-testnet.stellar.org" });
    expect(problems).toEqual(expect.arrayContaining([
      "JWT_SECRET contains a placeholder value",
      "CORS_ALLOWED_ORIGINS must not contain a wildcard",
      "mainnet cannot use a testnet Horizon URL",
    ]));
  });

  it("produces a stable short fingerprint without exposing values", () => {
    const fingerprint = configurationFingerprint(base);
    expect(fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(fingerprint).not.toContain(base.JWT_SECRET);
  });
});
