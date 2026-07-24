import request from "supertest";
import TOML from "@iarna/toml";
import app from "../app.js";

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

  it("NETWORK_PASSPHRASE matches the active network (testnet in CI)", async () => {
    const res = await request(app).get("/.well-known/stellar.toml");
    const doc = TOML.parse(res.text);
    expect(doc.NETWORK_PASSPHRASE).toBe("Test SDF Network ; September 2015");
  });

  it("contains USDC [[CURRENCIES]] block with correct issuer for testnet", async () => {
    const res = await request(app).get("/.well-known/stellar.toml");
    const doc = TOML.parse(res.text);
    expect(Array.isArray(doc.CURRENCIES)).toBe(true);
    const usdc = doc.CURRENCIES.find((c) => c.code === "USDC");
    expect(usdc).toBeDefined();
    expect(usdc.issuer).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(usdc.is_asset_anchored).toBe(true);
  });

  it("includes [DOCUMENTATION] when ORG_NAME is set", async () => {
    process.env.ORG_NAME = "DeenBridge";
    const res = await request(app).get("/.well-known/stellar.toml");
    const doc = TOML.parse(res.text);
    expect(doc.DOCUMENTATION).toBeDefined();
    expect(doc.DOCUMENTATION.ORG_NAME).toBe("DeenBridge");
    delete process.env.ORG_NAME;
  });

  it("omits [DOCUMENTATION] when no ORG_* env vars are set", async () => {
    const saved = {};
    for (const key of [
      "ORG_NAME",
      "ORG_URL",
      "ORG_DESCRIPTION",
      "ORG_LOGO",
      "ORG_TWITTER",
      "ORG_GITHUB",
    ]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }

    const res = await request(app).get("/.well-known/stellar.toml");
    const doc = TOML.parse(res.text);
    expect(doc.DOCUMENTATION).toBeUndefined();

    for (const [key, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("includes ACCOUNTS when STELLAR_PLATFORM_PUBLIC_KEY is set", async () => {
    const key = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    process.env.STELLAR_PLATFORM_PUBLIC_KEY = key;

    const res = await request(app).get("/.well-known/stellar.toml");
    const doc = TOML.parse(res.text);
    expect(doc.ACCOUNTS).toContain(key);

    delete process.env.STELLAR_PLATFORM_PUBLIC_KEY;
  });

  it("omits ACCOUNTS gracefully when no platform key is available", async () => {
    const saved = process.env.STELLAR_PLATFORM_PUBLIC_KEY;
    delete process.env.STELLAR_PLATFORM_PUBLIC_KEY;

    const res = await request(app).get("/.well-known/stellar.toml");
    expect(res.statusCode).toBe(200);

    if (saved) process.env.STELLAR_PLATFORM_PUBLIC_KEY = saved;
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
