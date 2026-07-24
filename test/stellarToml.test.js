import request from "supertest";
import TOML from "@iarna/toml";
import app from "../app.js";
import {
  networkPassphrase,
  USDC_ISSUER,
} from "../src/services/stellar/stellarService.js";

/**
 * Helper to safely override process.env variables and guarantee exact restoration in a finally block.
 */
const withEnv = async (overrides, fn) => {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

describe("GET /.well-known/stellar.toml", () => {
  it("returns 200 with Content-Type text/toml", async () => {
    const res = await request(app).get("/.well-known/stellar.toml");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/toml/);
  });

  it("includes Access-Control-Allow-Origin: *", async () => {
    const res = await request(app).get("/.well-known/stellar.toml");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("body parses as valid TOML", async () => {
    const res = await request(app).get("/.well-known/stellar.toml");
    const doc = TOML.parse(res.text);
    expect(doc).toBeDefined();
    expect(typeof doc.VERSION).toBe("string");
  });

  it("NETWORK_PASSPHRASE matches the active network configuration", async () => {
    const res = await request(app).get("/.well-known/stellar.toml");
    const doc = TOML.parse(res.text);
    expect(doc.NETWORK_PASSPHRASE).toBe(networkPassphrase);
  });

  it("contains USDC [[CURRENCIES]] block with correct issuer for configured network", async () => {
    const res = await request(app).get("/.well-known/stellar.toml");
    const doc = TOML.parse(res.text);
    expect(Array.isArray(doc.CURRENCIES)).toBe(true);
    const usdc = doc.CURRENCIES.find((c) => c.code === "USDC");
    expect(usdc).toBeDefined();
    expect(usdc.issuer).toBe(USDC_ISSUER);
    expect(usdc.is_asset_anchored).toBe(true);
  });

  it("includes [DOCUMENTATION] when ORG_NAME is set", async () => {
    await withEnv({ ORG_NAME: "DeenBridge" }, async () => {
      const res = await request(app).get("/.well-known/stellar.toml");
      const doc = TOML.parse(res.text);
      expect(doc.DOCUMENTATION).toBeDefined();
      expect(doc.DOCUMENTATION.ORG_NAME).toBe("DeenBridge");
    });
  });

  it("escapes quotes, backslashes, and newlines safely in [DOCUMENTATION] values", async () => {
    const complexDesc = 'DeenBridge "Platform"\nLine 2 \\ test';
    await withEnv({ ORG_DESCRIPTION: complexDesc }, async () => {
      const res = await request(app).get("/.well-known/stellar.toml");
      const doc = TOML.parse(res.text);
      expect(doc.DOCUMENTATION).toBeDefined();
      expect(doc.DOCUMENTATION.ORG_DESCRIPTION).toBe(complexDesc);
    });
  });

  it("omits [DOCUMENTATION] when no ORG_* env vars are set", async () => {
    const overrides = {
      ORG_NAME: undefined,
      ORG_URL: undefined,
      ORG_DESCRIPTION: undefined,
      ORG_LOGO: undefined,
      ORG_TWITTER: undefined,
      ORG_GITHUB: undefined,
    };
    await withEnv(overrides, async () => {
      const res = await request(app).get("/.well-known/stellar.toml");
      const doc = TOML.parse(res.text);
      expect(doc.DOCUMENTATION).toBeUndefined();
    });
  });

  it("includes ACCOUNTS when STELLAR_PLATFORM_PUBLIC_KEY is set", async () => {
    const key = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    await withEnv({ STELLAR_PLATFORM_PUBLIC_KEY: key }, async () => {
      const res = await request(app).get("/.well-known/stellar.toml");
      const doc = TOML.parse(res.text);
      expect(doc.ACCOUNTS).toContain(key);
    });
  });

  it("omits ACCOUNTS gracefully when no STELLAR_PLATFORM_PUBLIC_KEY is set", async () => {
    await withEnv({ STELLAR_PLATFORM_PUBLIC_KEY: undefined }, async () => {
      const res = await request(app).get("/.well-known/stellar.toml");
      expect(res.statusCode).toBe(200);
      const doc = TOML.parse(res.text);
      expect(doc.ACCOUNTS).toBeUndefined();
    });
  });

  it("emits SIGNING_KEY only when a valid public Stellar key starting with G is supplied", async () => {
    const validKey = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    const invalidSeed = "SD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

    await withEnv({ SIGNING_KEY: validKey }, async () => {
      const res = await request(app).get("/.well-known/stellar.toml");
      const doc = TOML.parse(res.text);
      expect(doc.SIGNING_KEY).toBe(validKey);
    });

    await withEnv({ SIGNING_KEY: invalidSeed }, async () => {
      const res = await request(app).get("/.well-known/stellar.toml");
      const doc = TOML.parse(res.text);
      expect(doc.SIGNING_KEY).toBeUndefined();
      expect(res.text).toContain('# SIGNING_KEY = "G..."');
    });
  });

  it("does not require authentication", async () => {
    const res = await request(app).get("/.well-known/stellar.toml");
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("is not affected by /api rate limiter", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).get("/.well-known/stellar.toml")
      )
    );
    results.forEach((res) => expect(res.statusCode).toBe(200));
  });
});
