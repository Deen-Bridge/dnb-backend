import TOML from "@iarna/toml";
import request from "supertest";
import {
  NETWORK,
  USDC_ISSUER,
  networkPassphrase,
} from "../src/services/stellar/stellarService.js";
import {
  buildStellarToml,
  createStellarTomlConfig,
} from "../src/services/stellar/stellarTomlService.js";

const PLATFORM_ACCOUNT =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("SEP-1 stellar.toml", () => {
  let app;

  beforeAll(async () => {
    process.env.STELLAR_PLATFORM_PUBLIC_KEY = PLATFORM_ACCOUNT;
    ({ default: app } = await import("../app.js"));
  });

  afterAll(() => {
    delete process.env.STELLAR_PLATFORM_PUBLIC_KEY;
  });

  it("serves parseable network and asset metadata with SEP-1 headers", async () => {
    const response = await request(app)
      .get("/.well-known/stellar.toml")
      .set("Origin", "https://wallet.example");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/toml; charset=utf-8");
    expect(response.headers["access-control-allow-origin"]).toBe("*");

    const document = TOML.parse(response.text);
    expect(document.NETWORK_PASSPHRASE).toBe(networkPassphrase);
    expect(document.ACCOUNTS).toContain(PLATFORM_ACCOUNT);
    expect(document.DOCUMENTATION.ORG_NAME).toBe("DeenBridge");
    expect(document.CURRENCIES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "USDC",
          issuer: USDC_ISSUER,
          status: NETWORK === "mainnet" ? "live" : "test",
        }),
      ])
    );
  });

  it("omits unset optional metadata without producing invalid TOML", () => {
    const document = TOML.parse(buildStellarToml(createStellarTomlConfig({})));

    expect(document.ACCOUNTS).toBeUndefined();
    expect(document.WEB_AUTH_ENDPOINT).toBeUndefined();
    expect(document.SIGNING_KEY).toBeUndefined();
    expect(document.DOCUMENTATION.ORG_URL).toBeUndefined();
    expect(document.CURRENCIES[0].issuer).toBe(USDC_ISSUER);
  });
});
