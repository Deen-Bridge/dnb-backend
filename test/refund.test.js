// test/refund.test.js
import "dotenv/config";
import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import * as StellarSdk from "@stellar/stellar-sdk";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import Course from "../src/models/Course.js";
import Transaction from "../src/models/Transaction.js";
import Refund from "../src/models/Refund.js";
import paymentRoutes from "../src/routes/stellar/paymentRoutes.js";
import { server } from "../src/services/stellar/stellarService.js";

jest.setTimeout(60000);

const app = express();
app.use(express.json());
app.use("/api/stellar/payment", paymentRoutes);

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

const generateToken = (userId, role = "student") => {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "1h" });
};

describe("Non-Custodial Refund & Dispute Flow (#62)", () => {
  let buyer, educator, otherUser, adminUser;
  let buyerToken, educatorToken, otherToken, adminToken;
  let confirmedTx;
  let course;

  beforeAll(async () => {
    const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dnb-backend-test";

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri);
    }

    // Mock Horizon Server
    jest.spyOn(server, "loadAccount").mockImplementation(async (publicKey) => {
      const acc = new StellarSdk.Account(publicKey, "1000");
      acc.balances = [{ asset_type: "native", balance: "100" }];
      return acc;
    });

    jest.spyOn(server, "submitTransaction").mockImplementation(async () => ({
      hash: "mock_reverse_tx_hash_12345",
      ledger: 998877,
      successful: true,
    }));

    jest.spyOn(server, "transactions").mockImplementation(() => ({
      transaction: () => ({
        call: async () => ({
          successful: true,
          ledger: 998877,
          created_at: new Date().toISOString(),
        }),
      }),
    }));

    jest.spyOn(server, "operations").mockImplementation(() => ({
      forTransaction: () => ({
        call: async () => ({
          records: [],
        }),
      }),
    }));
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Course.deleteMany({});
    await Book.deleteMany({});
    await Transaction.deleteMany({});
    await Refund.deleteMany({});

    const buyerWallet = StellarSdk.Keypair.random().publicKey();
    const educatorWallet = StellarSdk.Keypair.random().publicKey();
    const otherWallet = StellarSdk.Keypair.random().publicKey();

    // Create test users
    buyer = await User.create({
      name: "Buyer Student",
      email: "buyer@example.com",
      password: "password123",
      role: "student",
      stellarWallet: { publicKey: buyerWallet },
      purchasedCourses: [],
    });

    educator = await User.create({
      name: "Educator Tutor",
      email: "tutor@example.com",
      password: "password123",
      role: "tutor",
      stellarWallet: { publicKey: educatorWallet },
    });

    otherUser = await User.create({
      name: "Other User",
      email: "other@example.com",
      password: "password123",
      role: "student",
      stellarWallet: { publicKey: otherWallet },
    });

    adminUser = await User.create({
      name: "Admin Arbiter",
      email: "admin@example.com",
      password: "password123",
      role: "admin",
    });

    buyerToken = generateToken(buyer._id, "student");
    educatorToken = generateToken(educator._id, "tutor");
    otherToken = generateToken(otherUser._id, "student");
    adminToken = generateToken(adminUser._id, "admin");

    // Create a purchased course and enroll buyer
    course = await Course.create({
      title: "Advanced Fiqh Course",
      description: "Comprehensive Fiqh study",
      category: "Fiqh",
      price: 50,
      createdBy: educator._id,
      enrolledUsers: [buyer._id],
    });

    buyer.purchasedCourses = [course._id];
    await buyer.save();

    // Create confirmed purchase transaction
    confirmedTx = await Transaction.create({
      stellarTxHash: "mock_original_tx_hash_99999",
      buyer: buyer._id,
      buyerWallet: buyer.stellarWallet.publicKey,
      creator: educator._id,
      creatorWallet: educator.stellarWallet.publicKey,
      itemType: "course",
      itemId: course._id,
      itemTypeModel: "Course",
      itemTitle: course.title,
      amount: "50",
      currency: "USDC",
      network: "testnet",
      status: "confirmed",
      confirmedAt: new Date(),
    });
  });

  describe("1. Refund Request (POST /transactions/:id/refund-request)", () => {
    it("should allow original buyer to request refund within window", async () => {
      const res = await request(app)
        .post(`/api/stellar/payment/transactions/${confirmedTx._id}/refund-request`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ reason: "Accidental purchase" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.refund.status).toBe("requested");
      expect(res.body.refund.reason).toBe("Accidental purchase");
    });

    it("should reject refund request from non-buyer (403)", async () => {
      const res = await request(app)
        .post(`/api/stellar/payment/transactions/${confirmedTx._id}/refund-request`)
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ reason: "Unwanted item" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("should enforce idempotency (prevent duplicate active refund requests)", async () => {
      // First request
      await request(app)
        .post(`/api/stellar/payment/transactions/${confirmedTx._id}/refund-request`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ reason: "First request" });

      // Second request
      const res = await request(app)
        .post(`/api/stellar/payment/transactions/${confirmedTx._id}/refund-request`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ reason: "Second request" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it("should reject refund request for non-confirmed transaction", async () => {
      const pendingTx = await Transaction.create({
        stellarTxHash: "mock_pending_hash",
        buyer: buyer._id,
        buyerWallet: buyer.stellarWallet.publicKey,
        creator: educator._id,
        creatorWallet: educator.stellarWallet.publicKey,
        itemType: "course",
        itemId: course._id,
        itemTypeModel: "Course",
        itemTitle: course.title,
        amount: "50",
        network: "testnet",
        status: "pending",
      });

      const res = await request(app)
        .post(`/api/stellar/payment/transactions/${pendingTx._id}/refund-request`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ reason: "Cancel pending" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("2. Reverse Payment XDR Build & Submission", () => {
    let refund;

    beforeEach(async () => {
      refund = await Refund.create({
        originalTransaction: confirmedTx._id,
        buyer: buyer._id,
        educator: educator._id,
        itemType: "course",
        itemId: course._id,
        amount: "50",
        currency: "USDC",
        reason: "Course not relevant",
        status: "requested",
      });
    });

    it("should allow educator to build unsigned reverse payment XDR", async () => {
      const res = await request(app)
        .post(`/api/stellar/payment/refunds/${refund._id}/build`)
        .set("Authorization", `Bearer ${educatorToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.unsignedXdr).toBeDefined();
      expect(res.body.refund.status).toBe("approved");
    });

    it("should prevent non-educator from building reverse payment XDR (403)", async () => {
      const res = await request(app)
        .post(`/api/stellar/payment/refunds/${refund._id}/build`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send();

      expect(res.status).toBe(403);
    });

    it("should submit signed XDR, verify Horizon, and revoke item access atomically", async () => {
      // Step 1: Educator builds
      const buildRes = await request(app)
        .post(`/api/stellar/payment/refunds/${refund._id}/build`)
        .set("Authorization", `Bearer ${educatorToken}`)
        .send();

      const unsignedXdr = buildRes.body.unsignedXdr;

      // Step 2: Educator submits signed XDR
      const res = await request(app)
        .post(`/api/stellar/payment/refunds/${refund._id}/submit`)
        .set("Authorization", `Bearer ${educatorToken}`)
        .send({ signedXdr: unsignedXdr });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.refund.status).toBe("confirmed");

      // Verify access revocation on User and Course
      const updatedBuyer = await User.findById(buyer._id);
      const updatedCourse = await Course.findById(course._id);
      const updatedTx = await Transaction.findById(confirmedTx._id);

      expect(updatedBuyer.purchasedCourses.map((c) => c.toString())).not.toContain(course._id.toString());
      expect(updatedCourse.enrolledUsers.map((u) => u.toString())).not.toContain(buyer._id.toString());
      expect(updatedCourse.enrolledUsers.length).toBe(0);
      expect(updatedTx.status).toBe("refunded");
    });

    it("should block submit if refund is not in approved state", async () => {
      // Try submitting directly on 'requested' refund without building
      const res = await request(app)
        .post(`/api/stellar/payment/refunds/${refund._id}/submit`)
        .set("Authorization", `Bearer ${educatorToken}`)
        .send({ signedXdr: "AAAA...XDR..." });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Must be 'approved' first/i);
    });
  });

  describe("3. Dispute Escalation & Admin Arbitration", () => {
    let refund;

    beforeEach(async () => {
      refund = await Refund.create({
        originalTransaction: confirmedTx._id,
        buyer: buyer._id,
        educator: educator._id,
        itemType: "course",
        itemId: course._id,
        amount: "50",
        currency: "USDC",
        reason: "Educator uncooperative",
        status: "rejected",
      });
    });

    it("should allow buyer to escalate rejected refund to disputed", async () => {
      const res = await request(app)
        .post(`/api/stellar/payment/refunds/${refund._id}/dispute`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.refund.status).toBe("disputed");

      const updatedTx = await Transaction.findById(confirmedTx._id);
      expect(updatedTx.status).toBe("disputed");
    });

    it("should allow admin/arbiter to record arbitration resolution", async () => {
      // Escalate to disputed first
      refund.status = "disputed";
      await refund.save();

      const res = await request(app)
        .patch(`/api/stellar/payment/refunds/${refund._id}/arbitrate`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          decision: "off_chain_resolved",
          notes: "Mediated off-chain resolution with educator",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.refund.status).toBe("resolved");
      expect(res.body.refund.resolution.decision).toBe("off_chain_resolved");
      expect(res.body.disclaimer).toMatch(/Non-custodial Limitation/i);
    });

    it("should reject arbitration attempt from non-admin user (403)", async () => {
      refund.status = "disputed";
      await refund.save();

      const res = await request(app)
        .patch(`/api/stellar/payment/refunds/${refund._id}/arbitrate`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ decision: "approved" });

      expect(res.status).toBe(403);
    });
  });
});
