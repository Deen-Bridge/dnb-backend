import { jest } from "@jest/globals";
import axios from "axios";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  isAllowedHomeDomain,
  getAnchorInfo,
} from "../src/services/stellar/anchorService.js";
import { USDC_ISSUER } from "../src/services/stellar/stellarService.js";

const ALLOWED_DOMAIN = "testanchor.stellar.org";

describe("mocking seam sanity", () => {
  it("jest.spyOn works on StellarToml.Resolver.resolve", async () => {
    const spy = jest
      .spyOn(StellarSdk.StellarToml.Resolver, "resolve")
      .mockResolvedValue({ TRANSFER_SERVER_SEP0024: "https://x" });
    const result = await StellarSdk.StellarToml.Resolver.resolve("x");
    expect(result.TRANSFER_SERVER_SEP0024).toBe("https://x");
    spy.mockRestore();
  });

  it("jest.spyOn works on axios.get", async () => {
    const spy = jest
      .spyOn(axios, "get")
      .mockResolvedValue({ data: { ok: true } });
    const result = await axios.get("https://x");
    expect(result.data.ok).toBe(true);
    spy.mockRestore();
  });
});

describe("isAllowedHomeDomain", () => {
  const originalDomains = process.env.ANCHOR_HOME_DOMAINS;

  beforeEach(() => {
    process.env.ANCHOR_HOME_DOMAINS = ALLOWED_DOMAIN;
  });

  afterEach(() => {
    process.env.ANCHOR_HOME_DOMAINS = originalDomains;
    jest.restoreAllMocks();
  });

  it("allows a domain on the allowlist", () => {
    expect(isAllowedHomeDomain(ALLOWED_DOMAIN)).toBe(true);
  });

  it("rejects a domain not on the allowlist", () => {
    expect(isAllowedHomeDomain("evil-anchor.example.com")).toBe(false);
  });
});

describe("getAnchorInfo", () => {
  const originalDomains = process.env.ANCHOR_HOME_DOMAINS;

  beforeEach(() => {
    process.env.ANCHOR_HOME_DOMAINS = ALLOWED_DOMAIN;
  });

  afterEach(() => {
    process.env.ANCHOR_HOME_DOMAINS = originalDomains;
    jest.restoreAllMocks();
  });

  it("rejects a non-allowlisted domain with 403 and never touches the network", async () => {
    const tomlSpy = jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve");
    const axiosSpy = jest.spyOn(axios, "get");

    await expect(getAnchorInfo("evil-anchor.example.com")).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(tomlSpy).not.toHaveBeenCalled();
    expect(axiosSpy).not.toHaveBeenCalled();
  });

  it("refuses an anchor whose USDC issuer does not match the platform issuer", async () => {
    jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
      TRANSFER_SERVER_SEP0024: "https://testanchor.stellar.org/sep24",
      WEB_AUTH_ENDPOINT: "https://testanchor.stellar.org/auth",
      SIGNING_KEY: "GDMOCKSIGNINGKEY0000000000000000000000000000000000000",
      CURRENCIES: [
        {
          code: "USDC",
          issuer: "GATTACKERISSUER00000000000000000000000000000000000000",
        },
      ],
    });
    const axiosSpy = jest.spyOn(axios, "get");

    await expect(getAnchorInfo(ALLOWED_DOMAIN)).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(axiosSpy).not.toHaveBeenCalled();
  });

  it("refuses an anchor whose toml does not list a USDC currency at all", async () => {
    jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
      TRANSFER_SERVER_SEP0024: "https://testanchor.stellar.org/sep24",
      WEB_AUTH_ENDPOINT: "https://testanchor.stellar.org/auth",
      SIGNING_KEY: "GDMOCKSIGNINGKEY0000000000000000000000000000000000000",
      CURRENCIES: [{ code: "EURC", issuer: "GSOMEOTHERISSUER" }],
    });

    await expect(getAnchorInfo(ALLOWED_DOMAIN)).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it("refuses an anchor missing required toml fields", async () => {
    jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
      SIGNING_KEY: "GDMOCKSIGNINGKEY0000000000000000000000000000000000000",
    });

    await expect(getAnchorInfo(ALLOWED_DOMAIN)).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it("returns normalized deposit/withdraw info when the anchor's issuer matches", async () => {
    jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
      TRANSFER_SERVER_SEP0024: "https://testanchor.stellar.org/sep24",
      WEB_AUTH_ENDPOINT: "https://testanchor.stellar.org/auth",
      SIGNING_KEY: "GDMOCKSIGNINGKEY0000000000000000000000000000000000000",
      CURRENCIES: [{ code: "USDC", issuer: USDC_ISSUER }],
    });
    jest.spyOn(axios, "get").mockResolvedValue({
      data: {
        deposit: { USDC: { enabled: true, min_amount: 1, max_amount: 1000 } },
        withdraw: { USDC: { enabled: false } },
      },
    });

    const info = await getAnchorInfo(ALLOWED_DOMAIN);
    expect(info.currency.issuer).toBe(USDC_ISSUER);
    expect(info.deposit).toEqual({
      enabled: true,
      minAmount: 1,
      maxAmount: 1000,
      feeFixed: null,
      feePercent: null,
    });
    expect(info.withdraw.enabled).toBe(false);
  });

  it("passes a bounded timeout to the /info call so a hung anchor rejects instead of hanging the request", async () => {
    jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
      TRANSFER_SERVER_SEP0024: "https://testanchor.stellar.org/sep24",
      WEB_AUTH_ENDPOINT: "https://testanchor.stellar.org/auth",
      SIGNING_KEY: "GDMOCKSIGNINGKEY0000000000000000000000000000000000000",
      CURRENCIES: [{ code: "USDC", issuer: USDC_ISSUER }],
    });
    const axiosSpy = jest.spyOn(axios, "get").mockResolvedValue({ data: {} });

    await getAnchorInfo(ALLOWED_DOMAIN);

    expect(axiosSpy).toHaveBeenCalledWith(
      "https://testanchor.stellar.org/sep24/info",
      expect.objectContaining({ timeout: expect.any(Number) })
    );
    const [, options] = axiosSpy.mock.calls[0];
    expect(options.timeout).toBeGreaterThan(0);
  });

  it("surfaces a hung /info call as a 502 rather than hanging forever", async () => {
    jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
      TRANSFER_SERVER_SEP0024: "https://testanchor.stellar.org/sep24",
      WEB_AUTH_ENDPOINT: "https://testanchor.stellar.org/auth",
      SIGNING_KEY: "GDMOCKSIGNINGKEY0000000000000000000000000000000000000",
      CURRENCIES: [{ code: "USDC", issuer: USDC_ISSUER }],
    });
    // Simulate the real axios timeout behavior: a request that never resolves
    // on its own is rejected by axios once the configured timeout elapses.
    jest.spyOn(axios, "get").mockImplementation((url, options) => {
      expect(options.timeout).toBeGreaterThan(0);
      return new Promise((_resolve, reject) => {
        const timer = setTimeout(() => {
          const err = new Error("timeout of " + options.timeout + "ms exceeded");
          err.code = "ECONNABORTED";
          reject(err);
        }, 50);
        timer.unref?.();
      });
    });

    await expect(getAnchorInfo(ALLOWED_DOMAIN)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
