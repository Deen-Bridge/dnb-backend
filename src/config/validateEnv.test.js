import { jest } from "@jest/globals";
import { validateEnv } from "./validateEnv.js";

describe("validateEnv", () => {
  const originalEnv = process.env;
  const originalExit = process.exit;
  const originalLog = console.error;

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
    delete process.env.DONATION_WALLET_PUBLIC_KEY;
    delete process.env.PLATFORM_WALLET_PUBLIC_KEY;
    delete process.env.SEP10_SIGNING_SECRET;
    delete process.env.SEP10_HOME_DOMAIN;
    delete process.env.SEP10_WEB_AUTH_DOMAIN;
    delete process.env.SENDLIB_API_URL;

    jest.spyOn(process, "exit").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    process.exit = originalExit;
    console.error = originalLog;
  });

  describe("Horizon defaults", () => {
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

  describe("Production validation — fail-fast on missing required vars", () => {
    it("should exit process when production missing payment var DONATION_WALLET_PUBLIC_KEY", () => {
      process.env.NODE_ENV = "production";
      process.env.SENDLIB_API_URL = "https://sendlib.example.com";
      process.env.SEP10_SIGNING_SECRET = "test-secret";
      process.env.SEP10_HOME_DOMAIN = "example.com";
      process.env.SEP10_WEB_AUTH_DOMAIN = "example.com";
      delete process.env.DONATION_WALLET_PUBLIC_KEY;

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("DONATION_WALLET_PUBLIC_KEY")
      );
    });

    it("should exit process when production missing Stellar var SEP10_SIGNING_SECRET", () => {
      process.env.NODE_ENV = "production";
      process.env.DONATION_WALLET_PUBLIC_KEY = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
      process.env.PLATFORM_WALLET_PUBLIC_KEY = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
      process.env.SENDLIB_API_URL = "https://sendlib.example.com";
      delete process.env.SEP10_SIGNING_SECRET;

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("SEP10_SIGNING_SECRET")
      );
    });

    it("should exit process when production missing email var SENDLIB_API_URL", () => {
      process.env.NODE_ENV = "production";
      process.env.DONATION_WALLET_PUBLIC_KEY = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
      process.env.PLATFORM_WALLET_PUBLIC_KEY = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
      process.env.SEP10_SIGNING_SECRET = "test-secret";
      process.env.SEP10_HOME_DOMAIN = "example.com";
      process.env.SEP10_WEB_AUTH_DOMAIN = "example.com";
      delete process.env.SENDLIB_API_URL;

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("SENDLIB_API_URL")
      );
    });
  });

  describe("Format validation — Stellar keys", () => {
    it("should exit for invalid Stellar public key format (bad prefix)", () => {
      process.env.DONATION_WALLET_PUBLIC_KEY = "BADKEY1234567890123456789012345678901234567890123456";

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid Stellar public key format")
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("DONATION_WALLET_PUBLIC_KEY")
      );
    });

    it("should exit for invalid Stellar public key format (wrong length)", () => {
      process.env.DONATION_WALLET_PUBLIC_KEY = "GSHORT";

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid Stellar public key format")
      );
    });

    it("should pass validation for valid Stellar public key format", () => {
      process.env.DONATION_WALLET_PUBLIC_KEY = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
      process.env.PLATFORM_WALLET_PUBLIC_KEY = "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY";

      validateEnv();

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("Format validation — URLs", () => {
    it("should exit for invalid URL format in SENDLIB_API_URL", () => {
      process.env.SENDLIB_API_URL = "not-a-valid-url";

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid URL format")
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("SENDLIB_API_URL")
      );
    });

    it("should exit for invalid URL format in FRONTEND_URL", () => {
      process.env.FRONTEND_URL = ":::invalid:::";

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid URL format")
      );
    });

    it("should pass validation for valid HTTPS URL", () => {
      process.env.SENDLIB_API_URL = "https://api.sendlib.example.com";
      process.env.FRONTEND_URL = "https://app.example.com";

      validateEnv();

      expect(process.exit).not.toHaveBeenCalled();
    });

    it("should allow empty string for optional URL vars", () => {
      process.env.FRONTEND_URL = "";
      process.env.EMAIL_ASSET_URL = "";

      validateEnv();

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("Format validation — JWT_SECRET", () => {
    it("should exit in production for short JWT_SECRET", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "short";

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("JWT_SECRET is too short")
      );
    });

    it("should warn but not exit in development for short JWT_SECRET", () => {
      process.env.NODE_ENV = "development";
      process.env.JWT_SECRET = "short";

      validateEnv();

      expect(process.exit).not.toHaveBeenCalled();
    });

    it("should pass for JWT_SECRET with 32+ characters", () => {
      process.env.JWT_SECRET = "a".repeat(32);

      validateEnv();

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("Format validation — PORT", () => {
    it("should exit for non-numeric PORT", () => {
      process.env.PORT = "not-a-number";

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid PORT value")
      );
    });

    it("should exit for PORT out of range (too low)", () => {
      process.env.PORT = "0";

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid PORT value")
      );
    });

    it("should exit for PORT out of range (too high)", () => {
      process.env.PORT = "99999";

      validateEnv();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid PORT value")
      );
    });

    it("should pass for valid PORT", () => {
      process.env.PORT = "5000";

      validateEnv();

      expect(process.exit).not.toHaveBeenCalled();
    });

    it("should pass for PORT at boundaries", () => {
      process.env.PORT = "1";
      validateEnv();
      expect(process.exit).not.toHaveBeenCalled();

      jest.resetModules();
      process.env = {
        ...originalEnv,
        MONGO_URI: "mongodb://localhost:27017/test",
        JWT_SECRET: "test-secret-key-for-ci-minimum-32-chars",
        NODE_ENV: "test",
        PORT: "65535",
      };
      jest.spyOn(process, "exit").mockImplementation(() => {});
      jest.spyOn(console, "error").mockImplementation(() => {});

      validateEnv();

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("Test mode — no production restrictions", () => {
    it("should not exit in test mode when missing production secrets", () => {
      process.env.NODE_ENV = "test";
      delete process.env.DONATION_WALLET_PUBLIC_KEY;
      delete process.env.PLATFORM_WALLET_PUBLIC_KEY;
      delete process.env.SEP10_SIGNING_SECRET;
      delete process.env.SEP10_HOME_DOMAIN;
      delete process.env.SEP10_WEB_AUTH_DOMAIN;
      delete process.env.SENDLIB_API_URL;

      validateEnv();

      expect(process.exit).not.toHaveBeenCalled();
    });

    it("should not validate format in test mode", () => {
      process.env.NODE_ENV = "test";
      process.env.DONATION_WALLET_PUBLIC_KEY = "invalid-key";
      process.env.SENDLIB_API_URL = "not-a-url";
      process.env.PORT = "invalid";

      validateEnv();

      expect(process.exit).not.toHaveBeenCalled();
    });
  });
});
