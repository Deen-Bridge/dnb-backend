import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import walletRoutes from "../src/routes/stellar/walletRoutes.js";

const SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";
const ownerId = "64a000000000000000000001";
const otherId = "64a000000000000000000002";
const adminId = "64a000000000000000000003";
const tok = (id) => jwt.sign({ userId: id }, SECRET);
const KEY = "G" + "A".repeat(55);

describe("Stellar wallet lookup routes (#426)", () => {
  let app, findById;
  beforeAll(() => {
    app = express();
    app.use("/api/stellar/wallet", walletRoutes);
  });
  beforeEach(() => {
    findById = jest.spyOn(User, "findById").mockImplementation((id) => {
      const doc = {
        _id: id,
        name: "N",
        role: id === adminId ? "admin" : "student",
        stellarWallet: { publicKey: KEY },
      };
      const p = Promise.resolve(doc);
      p.select = () => Promise.resolve(doc);
      return p;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    `/api/stellar/wallet/balance/${KEY}`,
    `/api/stellar/wallet/check/${ownerId}`,
  ])("rejects unauthenticated GET %s with 401", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  it("non-owner gets identical 403 for existing and non-existing ids", async () => {
    const a = await request(app)
      .get(`/api/stellar/wallet/check/${ownerId}`)
      .set("Authorization", `Bearer ${tok(otherId)}`);
    const b = await request(app)
      .get(`/api/stellar/wallet/check/${new mongoose.Types.ObjectId()}`)
      .set("Authorization", `Bearer ${tok(otherId)}`);
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    expect(a.body).toEqual(b.body);
  });

  it("owner and admin can check", async () => {
    const o = await request(app)
      .get(`/api/stellar/wallet/check/${ownerId}`)
      .set("Authorization", `Bearer ${tok(ownerId)}`);
    expect(o.status).toBe(200);
    expect(o.body.hasWallet).toBe(true);
    const a = await request(app)
      .get(`/api/stellar/wallet/check/${ownerId}`)
      .set("Authorization", `Bearer ${tok(adminId)}`);
    expect(a.status).toBe(200);
  });
});
