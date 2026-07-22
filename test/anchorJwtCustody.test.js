import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import jsonwebtoken from "jsonwebtoken";
import axios from "axios";
import * as StellarSdk from "@stellar/stellar-sdk";
import app from "../app.js";
import User from "../src/models/User.js";
import logger from "../src/config/logger.js";
import { USDC_ISSUER } from "../src/services/stellar/stellarService.js";

const HOME_DOMAIN = "testanchor.stellar.org";
const WEB_AUTH_ENDPOINT = `https://${HOME_DOMAIN}/auth`;
const TRANSFER_SERVER = `https://${HOME_DOMAIN}/sep24`;

const testUser = {
  name: "JWT Custody Test User",
  email: "anchor_jwt_test@example.com",
  password: "password123",
  role: "student",
};

// The anchor's own JWT (we never verify its signature, only decode `exp`).
const FAKE_ANCHOR_JWT = jsonwebtoken.sign(
  { sub: "GABC", iss: HOME_DOMAIN },
  "anchor-side-secret-we-never-know",
  { expiresIn: "1h" }
);

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

const registerAndConnectWallet = async () => {
  await User.deleteMany({ email: testUser.email });
  const res = await request(app).post("/api/auth/register").send(testUser);
  const publicKey = StellarSdk.Keypair.random().publicKey();
  await User.findByIdAndUpdate(res.body.user.id, {
    stellarWallet: { publicKey, connectedAt: new Date(), network: "testnet" },
  });
  return { accessToken: res.body.accessToken, userId: res.body.user.id, publicKey };
};

describe("Anchor JWT custody - redaction", () => {
  it("never returns the anchor JWT in the /auth/verify response, and never logs it", async () => {
    process.env.ANCHOR_HOME_DOMAINS = HOME_DOMAIN;
    const { accessToken } = await registerAndConnectWallet();

    jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
      TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
      WEB_AUTH_ENDPOINT,
      SIGNING_KEY: StellarSdk.Keypair.random().publicKey(),
      CURRENCIES: [{ code: "USDC", issuer: USDC_ISSUER }],
    });
    jest.spyOn(axios, "get").mockResolvedValue({ data: {} });
    jest.spyOn(axios, "post").mockResolvedValue({ data: { token: FAKE_ANCHOR_JWT } });

    const loggedArgs = [];
    for (const level of ["info", "warn", "error", "debug"]) {
      jest.spyOn(logger, level).mockImplementation((...args) => {
        loggedArgs.push(args);
      });
    }

    const res = await request(app)
      .post("/api/stellar/anchor/auth/verify")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ homeDomain: HOME_DOMAIN, signedXdr: "fake-signed-xdr" });

    expect(res.statusCode).toBe(200);

    // The JWT must not appear anywhere in the response: body or headers.
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain(FAKE_ANCHOR_JWT);
    expect(bodyText.toLowerCase()).not.toContain("token");
    const headerText = JSON.stringify(res.headers);
    expect(headerText).not.toContain(FAKE_ANCHOR_JWT);

    // The JWT must not appear in any log line emitted during the request.
    const logText = JSON.stringify(loggedArgs);
    expect(logText).not.toContain(FAKE_ANCHOR_JWT);
  });

  it("returns 502 without leaking anything if the anchor omits the token field", async () => {
    process.env.ANCHOR_HOME_DOMAINS = HOME_DOMAIN;
    const { accessToken } = await registerAndConnectWallet();

    jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
      TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
      WEB_AUTH_ENDPOINT,
      SIGNING_KEY: StellarSdk.Keypair.random().publicKey(),
      CURRENCIES: [{ code: "USDC", issuer: USDC_ISSUER }],
    });
    jest.spyOn(axios, "get").mockResolvedValue({ data: {} });
    jest.spyOn(axios, "post").mockResolvedValue({ data: {} });

    const res = await request(app)
      .post("/api/stellar/anchor/auth/verify")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ homeDomain: HOME_DOMAIN, signedXdr: "fake-signed-xdr" });

    expect(res.statusCode).toBe(502);
    expect(res.body.success).toBe(false);
  });

  it("requires both homeDomain and signedXdr", async () => {
    process.env.ANCHOR_HOME_DOMAINS = HOME_DOMAIN;
    const { accessToken } = await registerAndConnectWallet();

    const res = await request(app)
      .post("/api/stellar/anchor/auth/verify")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ homeDomain: HOME_DOMAIN });

    expect(res.statusCode).toBe(400);
  });
});
