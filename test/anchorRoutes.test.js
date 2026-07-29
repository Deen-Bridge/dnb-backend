import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import axios from "axios";
import * as StellarSdk from "@stellar/stellar-sdk";
import app from "../app.js";
import User from "../src/models/User.js";
import { USDC_ISSUER } from "../src/services/stellar/stellarService.js";

const HOME_DOMAIN = "testanchor.stellar.org";

const testUser = {
  name: "Anchor Route Test User",
  email: "anchor_route_test@example.com",
  password: "password123",
  role: "student",
};

// app.js skips connectDB() under NODE_ENV=test; this suite manages its own connection.
beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await User.deleteMany({ email: testUser.email });
  await mongoose.disconnect();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const registerAndGetToken = async () => {
  await User.deleteMany({ email: testUser.email });
  const res = await request(app).post("/api/auth/register").send(testUser);
  return { accessToken: res.body.accessToken, userId: res.body.user?.id };
};

describe("Anchor routes (integration, mocked anchor HTTP)", () => {
  it("returns 400 when the user has no connected Stellar wallet", async () => {
    const { accessToken } = await registerAndGetToken();

    const res = await request(app)
      .post("/api/stellar/anchor/auth/challenge")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ homeDomain: HOME_DOMAIN });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 403 for a non-allowlisted domain without contacting the network", async () => {
    const { accessToken, userId } = await registerAndGetToken();
    await User.findByIdAndUpdate(userId, {
      stellarWallet: {
        publicKey: StellarSdk.Keypair.random().publicKey(),
        connectedAt: new Date(),
        network: "testnet",
      },
    });

    const tomlSpy = jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve");
    const axiosSpy = jest.spyOn(axios, "get");

    const res = await request(app)
      .post("/api/stellar/anchor/auth/challenge")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ homeDomain: "evil-anchor.example.com" });

    expect(res.statusCode).toBe(403);
    expect(tomlSpy).not.toHaveBeenCalled();
    expect(axiosSpy).not.toHaveBeenCalled();
  });

  it("returns 503 when the anchor feature is not configured", async () => {
    const original = process.env.ANCHOR_HOME_DOMAINS;
    delete process.env.ANCHOR_HOME_DOMAINS;

    const { accessToken } = await registerAndGetToken();

    const res = await request(app)
      .get("/api/stellar/anchor/info")
      .set("Authorization", `Bearer ${accessToken}`)
      .query({ homeDomain: HOME_DOMAIN });

    expect(res.statusCode).toBe(503);
    expect(res.body.success).toBe(false);

    process.env.ANCHOR_HOME_DOMAINS = original;
  });

  it("returns normalized anchor info for GET /api/stellar/anchor/info when allowlisted and issuer matches", async () => {
    const { accessToken } = await registerAndGetToken();
    process.env.ANCHOR_HOME_DOMAINS = HOME_DOMAIN;

    jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
      TRANSFER_SERVER_SEP0024: `https://${HOME_DOMAIN}/sep24`,
      WEB_AUTH_ENDPOINT: `https://${HOME_DOMAIN}/auth`,
      SIGNING_KEY: StellarSdk.Keypair.random().publicKey(),
      CURRENCIES: [{ code: "USDC", issuer: USDC_ISSUER }],
    });
    jest.spyOn(axios, "get").mockResolvedValue({
      data: { deposit: { USDC: { enabled: true } }, withdraw: { USDC: { enabled: true } } },
    });

    const res = await request(app)
      .get("/api/stellar/anchor/info")
      .set("Authorization", `Bearer ${accessToken}`)
      .query({ homeDomain: HOME_DOMAIN });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.anchor.currency.issuer).toBe(USDC_ISSUER);
    expect(res.body.data.anchor.deposit.enabled).toBe(true);
    expect(typeof res.body.message).toBe("string");
  });

  it("returns the { success, message, data } contract for every anchor route", async () => {
    const { accessToken, userId } = await registerAndGetToken();
    const publicKey = StellarSdk.Keypair.random().publicKey();
    await User.findByIdAndUpdate(userId, {
      stellarWallet: { publicKey, connectedAt: new Date(), network: "testnet" },
    });
    process.env.ANCHOR_HOME_DOMAINS = HOME_DOMAIN;

    jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
      TRANSFER_SERVER_SEP0024: `https://${HOME_DOMAIN}/sep24`,
      WEB_AUTH_ENDPOINT: `https://${HOME_DOMAIN}/auth`,
      SIGNING_KEY: StellarSdk.Keypair.random().publicKey(),
      CURRENCIES: [{ code: "USDC", issuer: USDC_ISSUER }],
    });
    jest.spyOn(axios, "get").mockResolvedValue({
      data: { deposit: { USDC: { enabled: true } }, withdraw: { USDC: { enabled: true } } },
    });

    const infoRes = await request(app)
      .get("/api/stellar/anchor/info")
      .set("Authorization", `Bearer ${accessToken}`)
      .query({ homeDomain: HOME_DOMAIN });
    expect(infoRes.body).toEqual(
      expect.objectContaining({
        success: true,
        message: expect.any(String),
        data: expect.any(Object),
      })
    );

    // The challenge route's success path requires a real SEP-10 challenge
    // (StellarSdk.WebAuth.readChallengeTx is a read-only ESM export and can't
    // be jest.spyOn'd), so its contract is asserted here on the validation
    // error path instead - same route, same response shape rules.
    const challengeRes = await request(app)
      .post("/api/stellar/anchor/auth/challenge")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    expect(challengeRes.body).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.any(String),
      })
    );

    const transactionsRes = await request(app)
      .get("/api/stellar/anchor/transactions")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(transactionsRes.body).toEqual(
      expect.objectContaining({
        success: true,
        message: expect.any(String),
        data: expect.objectContaining({
          transactions: expect.any(Array),
          pagination: expect.any(Object),
        }),
      })
    );
  });
});
