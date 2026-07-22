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
    expect(res.body.anchor.currency.issuer).toBe(USDC_ISSUER);
    expect(res.body.anchor.deposit.enabled).toBe(true);
  });
});
