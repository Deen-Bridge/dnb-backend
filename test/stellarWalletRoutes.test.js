import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const getAccountBalance = jest.fn();
const isValidPublicKey = jest.fn();

const authUserId = new mongoose.Types.ObjectId().toString();
const targetUserId = new mongoose.Types.ObjectId().toString();

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-key-for-ci-minimum-32-chars";

const User = {
  findById: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
};

jest.unstable_mockModule("../src/models/User.js", () => ({
  default: User,
}));

jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  isValidPublicKey,
  getAccountBalance,
  NETWORK: "testnet",
}));

const walletRoutes = (await import("../src/routes/stellar/walletRoutes.js"))
  .default;

const makeQuery = (result) => ({
  select: jest.fn(() => Promise.resolve(result)),
});

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/wallet", walletRoutes);
  return app;
};

const authHeader = () => {
  const token = jwt.sign({ userId: authUserId }, process.env.JWT_SECRET);
  return `Bearer ${token}`;
};

describe("Stellar wallet lookup route protection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockImplementation((id) => {
      if (id.toString() === authUserId) {
        return makeQuery({ _id: authUserId, name: "Authenticated User" });
      }
      if (id.toString() === targetUserId) {
        return makeQuery({
          _id: targetUserId,
          name: "Hidden Name",
          stellarWallet: {
            publicKey:
              "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          },
        });
      }
      return makeQuery(null);
    });
  });

  it("requires authentication before checking another user's wallet status", async () => {
    const res = await request(buildApp()).get(`/wallet/check/${targetUserId}`);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      message: "No token, authorization denied",
    });
    expect(User.findById).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid user IDs without querying the target user", async () => {
    const res = await request(buildApp())
      .get("/wallet/check/not-a-valid-object-id")
      .set("Authorization", authHeader());

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: "Invalid user ID",
    });
    expect(User.findById).toHaveBeenCalledTimes(1);
    expect(User.findById).toHaveBeenCalledWith(authUserId);
  });

  it("returns only wallet status for authenticated lookup requests", async () => {
    const res = await request(buildApp())
      .get(`/wallet/check/${targetUserId}`)
      .set("Authorization", authHeader());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      hasWallet: true,
    });
    expect(res.body.userName).toBeUndefined();
  });

  it("requires authentication before proxying wallet balance lookups", async () => {
    const publicKey = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

    const res = await request(buildApp()).get(`/wallet/balance/${publicKey}`);

    expect(res.statusCode).toBe(401);
    expect(isValidPublicKey).not.toHaveBeenCalled();
    expect(getAccountBalance).not.toHaveBeenCalled();
  });

  it("validates public keys before calling Horizon", async () => {
    isValidPublicKey.mockReturnValue(false);

    const res = await request(buildApp())
      .get("/wallet/balance/not-a-stellar-key")
      .set("Authorization", authHeader());

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: "Invalid public key",
    });
    expect(getAccountBalance).not.toHaveBeenCalled();
  });

  it("allows authenticated balance lookups for valid public keys", async () => {
    const publicKey = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    isValidPublicKey.mockReturnValue(true);
    getAccountBalance.mockResolvedValue({
      exists: true,
      xlmBalance: "3",
      usdcBalance: "10",
      hasTrustline: true,
    });

    const res = await request(buildApp())
      .get(`/wallet/balance/${publicKey}`)
      .set("Authorization", authHeader());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      publicKey,
      exists: true,
      xlmBalance: "3",
      usdcBalance: "10",
      hasTrustline: true,
    });
    expect(getAccountBalance).toHaveBeenCalledWith(publicKey);
  });
});
