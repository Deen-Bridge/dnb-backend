import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import * as StellarSdk from "@stellar/stellar-sdk";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import logger from "../src/config/logger.js";

const h = (name) => jest.fn((_req, res) => res.status(200).json({ handler: name }));
const mockAll = (names) => Object.fromEntries(names.map((n) => [n, h(n)]));

const payout = mockAll(["buildBatch", "submitBatch", "getMyBalance", "getMyStatement", "getMyHistory"]);
const payment = mockAll([
  "initializePayment", "submitPayment", "getQuote", "getPaymentPreflight",
  "getTransactionHistory", "getTransaction", "cancelTransaction", "sponsorshipStatus",
]);
const refund = mockAll([
  "requestRefund", "buildRefundXdr", "submitRefund", "rejectRefund", "escalateDispute", "arbitrateDispute",
]);
const donation = mockAll(["initializeDonation", "submitDonation", "getDonationStats"]);
const gift = mockAll(["initializeGift", "submitGift", "listGifts", "getGift", "claimInitialize", "claimSubmit"]);
const pledge = mockAll([
  "createPledge", "getPledgeStats", "initializePledgeCycle", "listPledgeCycles",
  "listPledges", "submitPledgeCycle", "updatePledgeStatus",
]);

jest.unstable_mockModule("../src/controllers/payoutController.js", () => payout);
jest.unstable_mockModule("../src/controllers/stellar/paymentController.js", () => payment);
jest.unstable_mockModule("../src/controllers/stellar/refundController.js", () => refund);
jest.unstable_mockModule("../src/controllers/stellar/reconciliationController.js", () => ({
  reconciliationStatus: h("reconciliationStatus"),
}));
jest.unstable_mockModule("../src/controllers/stellar/donationController.js", () => donation);
jest.unstable_mockModule("../src/controllers/stellar/giftController.js", () => gift);
jest.unstable_mockModule("../src/controllers/stellar/pledgeController.js", () => pledge);
jest.unstable_mockModule("../src/middlewares/authMiddleware.js", () => ({
  protect: (req, _res, next) => {
    req.user = { _id: new mongoose.Types.ObjectId(), role: "admin" };
    next();
  },
  authorizeRoles: () => (_req, _res, next) => next(),
}));
jest.unstable_mockModule("../src/middlewares/idempotency.js", () => ({
  idempotency: () => (_req, _res, next) => next(),
}));

const payoutRoutes = (await import("../src/routes/payoutRoutes.js")).default;
const paymentRoutes = (await import("../src/routes/stellar/paymentRoutes.js")).default;
const donationRoutes = (await import("../src/routes/stellar/donationRoutes.js")).default;
const giftRoutes = (await import("../src/routes/stellar/giftRoutes.js")).default;
const pledgeRoutes = (await import("../src/routes/stellar/pledgeRoutes.js")).default;

const app = express();
app.use(express.json());
app.use("/payouts", payoutRoutes);
app.use("/payment", paymentRoutes);
app.use("/donation", donationRoutes);
app.use("/gifts", giftRoutes);
app.use("/pledges", pledgeRoutes);
app.use(errorHandler);

const oid = () => new mongoose.Types.ObjectId().toString();
const G = StellarSdk.Keypair.random().publicKey();
const XDR = "AAAAAgAAAAA=";

const allHandlers = [payout, payment, refund, donation, gift, pledge].flatMap(Object.values);

const bad = async (method, url, body, field, handler) => {
  const res = await request(app)[method](url).send(body);
  expect(res.status).toBe(400);
  expect(res.body.message).toBe("Validation failed");
  if (field) expect(res.body.errors.map((e) => e.field)).toContain(field);
  expect(handler).not.toHaveBeenCalled();
};
const ok = async (method, url, body, handler) => {
  handler.mockClear();
  const res = await request(app)[method](url).send(body);
  expect(res.status).toBe(200);
  expect(handler).toHaveBeenCalledTimes(1);
};

describe("payment/payout request validation", () => {
  let warn;
  beforeEach(() => {
    allHandlers.forEach((f) => f.mockClear());
    warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  describe("payouts", () => {
    it("accepts a valid build and submit", async () => {
      await ok("post", "/payouts/build", { educatorIds: [oid()], minAmount: "10.5", dryRun: true }, payout.buildBatch);
      await ok("post", "/payouts/build", {}, payout.buildBatch);
      await ok("post", `/payouts/${oid()}/submit`, { signedXdrs: [XDR] }, payout.submitBatch);
      await ok("post", `/payouts/${oid()}/submit`, { signedXdr: XDR }, payout.submitBatch);
    });
    it("rejects bad build input", async () => {
      await bad("post", "/payouts/build", { minAmount: "-5" }, "minAmount", payout.buildBatch);
      await bad("post", "/payouts/build", { minAmount: "1.12345678" }, "minAmount", payout.buildBatch);
      await bad("post", "/payouts/build", { educatorIds: ["nope"] }, "educatorIds[0]", payout.buildBatch);
      await bad("post", "/payouts/build", { dryRun: "false" }, "dryRun", payout.buildBatch);
    });
    it("rejects bad submit input", async () => {
      await bad("post", "/payouts/not-an-id/submit", { signedXdrs: [XDR] }, "batchId", payout.submitBatch);
      await bad("post", `/payouts/${oid()}/submit`, { signedXdrs: [123] }, null, payout.submitBatch);
      await bad("post", `/payouts/${oid()}/submit`, { signedXdrs: [""] }, null, payout.submitBatch);
    });
  });

  describe("stellar payments and refunds", () => {
    it("accepts valid quote, path-payment init, refund calls", async () => {
      await ok("post", "/payment/quote", { itemType: "book", itemId: oid(), sendAssetCode: "XLM" }, payment.getQuote);
      await ok("post", "/payment/preflight", { itemType: "course", itemId: oid() }, payment.getPaymentPreflight);
      await ok("post", "/payment/initialize", {
        itemType: "book", itemId: oid(), buyerWallet: G,
        sendAsset: { code: "USDC", issuer: G }, sendMax: 12.5, path: [{ asset_type: "native" }],
      }, payment.initializePayment);
      await ok("post", `/payment/transactions/${oid()}/refund-request`, { reason: "broken" }, refund.requestRefund);
      await ok("post", `/payment/refunds/${oid()}/submit`, { signedXdr: XDR }, refund.submitRefund);
      await ok("patch", `/payment/refunds/${oid()}/arbitrate`, { decision: "approved" }, refund.arbitrateDispute);
    });
    it("rejects bad quote input", async () => {
      await bad("post", "/payment/quote", { itemType: "book", itemId: oid(), sendAssetCode: "TOOLONGASSETCODE" }, "sendAssetCode", payment.getQuote);
      await bad("post", "/payment/quote", { itemType: "book", itemId: oid(), sendAssetIssuer: "GABC" }, "sendAssetIssuer", payment.getQuote);
      await bad("post", "/payment/quote", { itemType: "book", itemId: "x" }, "itemId", payment.getQuote);
    });
    it("rejects bad path-payment fields on initialize", async () => {
      const base = { itemType: "book", itemId: oid(), buyerWallet: G };
      await bad("post", "/payment/initialize", { ...base, sendMax: "-1" }, "sendMax", payment.initializePayment);
      await bad("post", "/payment/initialize", { ...base, sendMax: "0" }, "sendMax", payment.initializePayment);
      await bad("post", "/payment/initialize", { ...base, sendMax: "1.12345678" }, "sendMax", payment.initializePayment);
      await bad("post", "/payment/initialize", { ...base, sendAsset: { code: "US-DC" } }, "sendAsset.code", payment.initializePayment);
      await bad("post", "/payment/initialize", { ...base, sendAsset: { code: "USDC", issuer: "G" + "A".repeat(55) } }, "sendAsset.issuer", payment.initializePayment);
    });
    it("rejects bad ids and bodies on transaction/refund routes", async () => {
      await bad("get", "/payment/transactions/zzz", {}, "transactionId", payment.getTransaction);
      await bad("delete", "/payment/transactions/zzz", {}, "transactionId", payment.cancelTransaction);
      await bad("post", `/payment/transactions/${oid()}/refund-request`, { reason: "" }, "reason", refund.requestRefund);
      await bad("post", "/payment/refunds/zzz/build", {}, "refundId", refund.buildRefundXdr);
      await bad("post", `/payment/refunds/${oid()}/submit`, {}, "signedXdr", refund.submitRefund);
      await bad("post", "/payment/refunds/zzz/dispute", {}, "refundId", refund.escalateDispute);
      await bad("patch", `/payment/refunds/${oid()}/arbitrate`, { decision: "maybe" }, "decision", refund.arbitrateDispute);
    });
  });

  describe("donations", () => {
    it("accepts string and number amounts", async () => {
      await ok("post", "/donation/initialize", { amount: "5", publicKey: G }, donation.initializeDonation);
      await ok("post", "/donation/initialize", { amount: 2.5, publicKey: G }, donation.initializeDonation);
      await ok("post", "/donation/submit", { donationId: oid(), signedXdr: XDR, requestSponsorship: true }, donation.submitDonation);
    });
    it("rejects negative, zero, 8-decimal amounts and bad addresses", async () => {
      for (const amount of ["-1", -1, "0", 0, "1.12345678", "abc", null, "1e3"]) {
        await bad("post", "/donation/initialize", { amount, publicKey: G }, "amount", donation.initializeDonation);
      }
      await bad("post", "/donation/initialize", { amount: "5", publicKey: "G" + "A".repeat(55) }, "publicKey", donation.initializeDonation);
      await bad("post", "/donation/initialize", { amount: "5", publicKey: G.toLowerCase() }, "publicKey", donation.initializeDonation);
      await bad("post", "/donation/initialize", { amount: "5", publicKey: G + "A" }, "publicKey", donation.initializeDonation);
      await bad("post", "/donation/submit", { donationId: "x", signedXdr: XDR }, "donationId", donation.submitDonation);
      await bad("post", "/donation/submit", { donationId: oid(), signedXdr: "" }, "signedXdr", donation.submitDonation);
    });
  });

  describe("gifts", () => {
    it("accepts valid requests", async () => {
      await ok("post", "/gifts/initialize", { itemType: "book", itemId: oid(), recipientUserId: oid() }, gift.initializeGift);
      await ok("post", "/gifts/submit", { giftId: oid(), signedXdr: XDR }, gift.submitGift);
      await ok("post", `/gifts/${oid()}/claim/initialize`, {}, gift.claimInitialize);
      await ok("post", `/gifts/${oid()}/claim/submit`, { signedXdr: XDR }, gift.claimSubmit);
    });
    it("rejects invalid requests", async () => {
      await bad("post", "/gifts/initialize", { itemType: "video", itemId: oid(), recipientUserId: oid() }, "itemType", gift.initializeGift);
      await bad("post", "/gifts/initialize", { itemType: "book", itemId: oid(), recipientUserId: "x" }, "recipientUserId", gift.initializeGift);
      await bad("post", "/gifts/submit", { giftId: "x", signedXdr: XDR }, "giftId", gift.submitGift);
      await bad("post", "/gifts/zzz/claim/initialize", {}, "id", gift.claimInitialize);
      await bad("post", `/gifts/${oid()}/claim/submit`, {}, "signedXdr", gift.claimSubmit);
      await bad("get", "/gifts/zzz", {}, "id", gift.getGift);
    });
  });

  describe("pledges", () => {
    const valid = { publicKey: G, amount: "10", cadence: "weekly", anchorDay: 2 };
    it("accepts valid requests", async () => {
      await ok("post", "/pledges", valid, pledge.createPledge);
      await ok("post", "/pledges", { ...valid, amount: 10 }, pledge.createPledge);
      await ok("patch", `/pledges/${oid()}/status`, { status: "paused" }, pledge.updatePledgeStatus);
      await ok("post", `/pledges/cycles/${oid()}/initialize`, {}, pledge.initializePledgeCycle);
      await ok("post", `/pledges/cycles/${oid()}/submit`, { signedXdr: XDR }, pledge.submitPledgeCycle);
    });
    it("rejects invalid requests", async () => {
      await bad("post", "/pledges", { ...valid, amount: "-3" }, "amount", pledge.createPledge);
      await bad("post", "/pledges", { ...valid, amount: "0" }, "amount", pledge.createPledge);
      await bad("post", "/pledges", { ...valid, amount: "1.12345678" }, "amount", pledge.createPledge);
      await bad("post", "/pledges", { ...valid, publicKey: "bad" }, "publicKey", pledge.createPledge);
      await bad("post", "/pledges", { ...valid, cadence: "hourly" }, "cadence", pledge.createPledge);
      await bad("post", "/pledges", { ...valid, anchorDay: 9 }, "anchorDay", pledge.createPledge);
      await bad("patch", `/pledges/${oid()}/status`, { status: "x" }, "status", pledge.updatePledgeStatus);
      await bad("patch", "/pledges/zzz/status", { status: "paused" }, "id", pledge.updatePledgeStatus);
      await bad("post", "/pledges/cycles/zzz/initialize", {}, "cycleId", pledge.initializePledgeCycle);
      await bad("post", `/pledges/cycles/${oid()}/submit`, {}, "signedXdr", pledge.submitPledgeCycle);
    });
  });
});
