// Fee-bump sponsorship (#30) — controller wiring for the payment AND donation
// submit paths. Proves:
//   - flag-off is byte-for-byte the original unsponsored path (regression guard)
//     for BOTH payment and donation, even when requestSponsorship:true is sent;
//   - flag-on sponsors the submit (fee-bump XDR, inner-hash verification,
//     sponsored fields, spend recorded);
//   - sponsorship-specific rejections (cap/whitelist) return a distinct 4xx and
//     never mark the row `failed`.
//
// stellarService is mocked (no network); feeSponsorService is mocked so the
// controller integration is tested in isolation from the service internals,
// which are covered end-to-end in feeSponsorService.test.js.
import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

const submitTransaction = jest.fn();
const verifyPaymentOperations = jest.fn();
const validateSignedPaymentXdr = jest.fn();
const getExplorerUrl = jest.fn((hash) => `https://stellar.expert/tx/${hash}`);
const recordSaleEarnings = jest.fn();
const grantItemAccess = jest.fn();
const enqueue = jest.fn();

// Sponsorship service mock — controllable per test.
const isFeeSponsorEnabled = jest.fn();
const prepareSponsoredSubmission = jest.fn();
const recordSponsorshipSpend = jest.fn();
const getSponsorshipStatus = jest.fn();
class SponsorshipError extends Error {
  constructor(code, message, { httpStatus = 422 } = {}) {
    super(message);
    this.name = "SponsorshipError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryUnsponsored = true;
  }
}

jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  STROOPS_PER_UNIT: 10000000n,
  toStroops: jest.fn(),
  fromStroops: jest.fn(),
  resolveAsset: jest.fn(),
  applySlippage: jest.fn(),
  findPaymentPaths: jest.fn(),
  buildPathPaymentTransaction: jest.fn(),
  calculateFeeSplit: jest.fn(() => null),
  buildSep7Uri: jest.fn(),
  isValidPublicKey: jest.fn(() => true),
  getAccountBalance: jest.fn(),
  MEMO_REQUIRED_DATA_KEY: "config.memo_required",
  isMemoRequired: jest.fn(),
  PREFLIGHT_REASON_CODES: {},
  preflightPayment: jest.fn(),
  buildPaymentTransaction: jest.fn(),
  buildReversePaymentTransaction: jest.fn(),
  submitTransaction,
  verifyTransaction: jest.fn(),
  verifyPaymentOperations,
  validateSignedPaymentXdr,
  hasUsdcTrustline: jest.fn(),
  getExplorerUrl,
  getAccountExplorerUrl: jest.fn(),
  server: {},
  USDC: "USDC",
  USDC_ISSUER: "",
  NETWORK: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  DONATION_WALLET_PUBLIC_KEY: "GDONATION",
  PLATFORM_FEE_PERCENT: 0,
  PLATFORM_WALLET_PUBLIC_KEY: "",
}));

jest.unstable_mockModule("../src/services/stellar/feeSponsorService.js", () => ({
  isFeeSponsorEnabled,
  prepareSponsoredSubmission,
  recordSponsorshipSpend,
  getSponsorshipStatus,
  SponsorshipError,
}));

jest.unstable_mockModule("../src/services/payoutService.js", () => ({
  recordSaleEarnings,
}));
jest.unstable_mockModule("../src/services/stellar/reconciliationService.js", () => ({
  grantItemAccess,
}));
jest.unstable_mockModule("../src/jobs/queue.js", () => ({ enqueue }));

const { submitPayment } = await import(
  "../src/controllers/stellar/paymentController.js"
);
const { submitDonation } = await import(
  "../src/controllers/stellar/donationController.js"
);
const Transaction = (await import("../src/models/Transaction.js")).default;

const makeQuery = (result) => {
  const query = {
    session: jest.fn(() => Promise.resolve(result)),
    populate: jest.fn(() => query),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
};

const makeSession = () => ({
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(() => Promise.resolve()),
  abortTransaction: jest.fn(() => Promise.resolve()),
  endSession: jest.fn(),
});

const buyerWallet = "GBUYER";
const creatorWallet = "GCREATOR";

const mountApp = (userId, handler, path = "/submit") => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: userId };
    next();
  });
  app.post(path, handler);
  return app;
};

let buyerId;
let session;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.FEE_SPONSOR_ENABLED;
  buyerId = new mongoose.Types.ObjectId();
  session = makeSession();
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  verifyPaymentOperations.mockResolvedValue({ verified: true });
  recordSaleEarnings.mockResolvedValue({ success: true });
  grantItemAccess.mockResolvedValue(undefined);
  enqueue.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

// ── PAYMENT ──────────────────────────────────────────────────────────────────

describe("submitPayment — fee sponsorship", () => {
  const makePurchaseTx = () => ({
    _id: new mongoose.Types.ObjectId(),
    buyer: buyerId,
    creator: new mongoose.Types.ObjectId(),
    buyerWallet,
    creatorWallet,
    itemType: "book",
    itemId: new mongoose.Types.ObjectId(),
    itemTitle: "Book",
    amount: "15",
    currency: "USDC",
    memo: "DNB-BOOK-abcd1234",
    settlement: "direct",
    status: "pending",
    save: jest.fn(function () {
      return Promise.resolve(this);
    }),
  });

  it("REGRESSION: flag off passes the raw XDR straight through; never sponsors", async () => {
    isFeeSponsorEnabled.mockReturnValue(false);
    const tx = makePurchaseTx();
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));
    submitTransaction.mockResolvedValue({ hash: "H_RAW", ledger: 10, successful: true });

    const res = await request(mountApp(buyerId, submitPayment))
      .post("/submit")
      .send({ transactionId: tx._id.toString(), signedXdr: "RAW_XDR", requestSponsorship: true });

    expect(res.statusCode).toBe(200);
    // Same XDR submitted as-is; no fee-bump path taken.
    expect(prepareSponsoredSubmission).not.toHaveBeenCalled();
    expect(submitTransaction).toHaveBeenCalledWith("RAW_XDR");
    // Base validation ran (unchanged behaviour).
    expect(validateSignedPaymentXdr).toHaveBeenCalledTimes(1);
    // Verification runs against the submitted hash, not an inner hash.
    expect(verifyPaymentOperations).toHaveBeenCalledWith(
      "H_RAW",
      expect.any(Array),
      "USDC"
    );
    expect(tx.status).toBe("confirmed");
    expect(tx.sponsored).toBeFalsy();
    expect(res.body.transaction.sponsored).toBeUndefined();
    expect(recordSponsorshipSpend).not.toHaveBeenCalled();
  });

  it("flag on: wraps as a fee-bump, verifies the inner hash, records spend, marks sponsored", async () => {
    isFeeSponsorEnabled.mockReturnValue(true);
    prepareSponsoredSubmission.mockResolvedValue({
      innerHash: "H_INNER",
      outerHash: "H_OUTER",
      feeBumpXdr: "FEEBUMP_XDR",
      maxFeeStroops: 1000000,
    });
    const tx = makePurchaseTx();
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));
    submitTransaction.mockResolvedValue({
      hash: "H_OUTER",
      ledger: 20,
      successful: true,
      feeCharged: "300",
    });

    const res = await request(mountApp(buyerId, submitPayment))
      .post("/submit")
      .send({ transactionId: tx._id.toString(), signedXdr: "RAW_XDR", requestSponsorship: true });

    expect(res.statusCode).toBe(200);
    expect(prepareSponsoredSubmission).toHaveBeenCalledTimes(1);
    // The fee-bump envelope is submitted, not the raw inner XDR.
    expect(submitTransaction).toHaveBeenCalledWith("FEEBUMP_XDR");
    // Base validation is NOT re-run (structural whitelist supersedes it).
    expect(validateSignedPaymentXdr).not.toHaveBeenCalled();
    // On-chain verification runs against the INNER hash.
    expect(verifyPaymentOperations).toHaveBeenCalledWith(
      "H_INNER",
      expect.any(Array),
      "USDC"
    );
    expect(recordSponsorshipSpend).toHaveBeenCalledWith(
      expect.objectContaining({ feeStroops: 300 })
    );
    expect(tx.sponsored).toBe(true);
    expect(tx.feeBumpTxHash).toBe("H_OUTER");
    expect(tx.sponsorFeeCharged).toBe("300");
    expect(tx.stellarTxHash).toBe("H_INNER");
    expect(res.body.transaction).toMatchObject({
      sponsored: true,
      feeBumpTxHash: "H_OUTER",
      hash: "H_INNER",
    });
  });

  it("cap rejection returns a distinct 4xx and does NOT mark the row failed", async () => {
    isFeeSponsorEnabled.mockReturnValue(true);
    prepareSponsoredSubmission.mockRejectedValue(
      new SponsorshipError("daily_cap_exceeded", "cap", { httpStatus: 429 })
    );
    const tx = makePurchaseTx();
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));

    const res = await request(mountApp(buyerId, submitPayment))
      .post("/submit")
      .send({ transactionId: tx._id.toString(), signedXdr: "RAW_XDR", requestSponsorship: true });

    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({
      success: false,
      retryUnsponsored: true,
      sponsorship: { approved: false, reason: "daily_cap_exceeded" },
    });
    // Row is untouched: not failed, not submitted, no on-network submit.
    expect(tx.status).toBe("pending");
    expect(tx.save).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
  });

  it("whitelist rejection returns 422 and does NOT mark the row failed", async () => {
    isFeeSponsorEnabled.mockReturnValue(true);
    prepareSponsoredSubmission.mockRejectedValue(
      new SponsorshipError("whitelist_rejected", "bad", { httpStatus: 422 })
    );
    const tx = makePurchaseTx();
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));

    const res = await request(mountApp(buyerId, submitPayment))
      .post("/submit")
      .send({ transactionId: tx._id.toString(), signedXdr: "RAW_XDR", requestSponsorship: true });

    expect(res.statusCode).toBe(422);
    expect(tx.status).toBe("pending");
    expect(tx.save).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();
  });
});

// ── DONATION ─────────────────────────────────────────────────────────────────

describe("submitDonation — fee sponsorship", () => {
  const makeDonationTx = () => ({
    _id: new mongoose.Types.ObjectId(),
    buyer: buyerId,
    buyerWallet,
    creatorWallet: "GDONATION",
    type: "donation",
    amount: "5",
    currency: "USDC",
    memo: "DNB-SADAQAH",
    status: "pending",
    save: jest.fn(function () {
      return Promise.resolve(this);
    }),
  });

  it("REGRESSION: flag off passes the raw XDR straight through; never sponsors", async () => {
    isFeeSponsorEnabled.mockReturnValue(false);
    const tx = makeDonationTx();
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));
    submitTransaction.mockResolvedValue({ hash: "H_RAW", ledger: 10, successful: true });

    const res = await request(mountApp(buyerId, submitDonation))
      .post("/submit")
      .send({ donationId: tx._id.toString(), signedXdr: "RAW_XDR", requestSponsorship: true });

    expect(res.statusCode).toBe(200);
    expect(prepareSponsoredSubmission).not.toHaveBeenCalled();
    expect(submitTransaction).toHaveBeenCalledWith("RAW_XDR");
    expect(validateSignedPaymentXdr).toHaveBeenCalledTimes(1);
    expect(verifyPaymentOperations).toHaveBeenCalledWith("H_RAW", expect.any(Array));
    expect(tx.status).toBe("confirmed");
    expect(tx.sponsored).toBeFalsy();
    expect(res.body.sponsored).toBeUndefined();
    expect(recordSponsorshipSpend).not.toHaveBeenCalled();
  });

  it("flag on: wraps as a fee-bump, verifies the inner hash, records spend", async () => {
    isFeeSponsorEnabled.mockReturnValue(true);
    prepareSponsoredSubmission.mockResolvedValue({
      innerHash: "H_INNER",
      outerHash: "H_OUTER",
      feeBumpXdr: "FEEBUMP_XDR",
      maxFeeStroops: 1000000,
    });
    const tx = makeDonationTx();
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));
    submitTransaction.mockResolvedValue({
      hash: "H_OUTER",
      ledger: 20,
      successful: true,
      feeCharged: "200",
    });

    const res = await request(mountApp(buyerId, submitDonation))
      .post("/submit")
      .send({ donationId: tx._id.toString(), signedXdr: "RAW_XDR", requestSponsorship: true });

    expect(res.statusCode).toBe(200);
    expect(submitTransaction).toHaveBeenCalledWith("FEEBUMP_XDR");
    expect(validateSignedPaymentXdr).not.toHaveBeenCalled();
    expect(verifyPaymentOperations).toHaveBeenCalledWith("H_INNER", expect.any(Array));
    expect(recordSponsorshipSpend).toHaveBeenCalledWith(
      expect.objectContaining({ feeStroops: 200 })
    );
    expect(tx.sponsored).toBe(true);
    expect(tx.feeBumpTxHash).toBe("H_OUTER");
    expect(res.body).toMatchObject({ sponsored: true, feeBumpTxHash: "H_OUTER", txHash: "H_INNER" });
  });

  it("cap rejection returns a distinct 4xx and does NOT mark the donation failed", async () => {
    isFeeSponsorEnabled.mockReturnValue(true);
    prepareSponsoredSubmission.mockRejectedValue(
      new SponsorshipError("daily_cap_exceeded", "cap", { httpStatus: 429 })
    );
    const tx = makeDonationTx();
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));

    const res = await request(mountApp(buyerId, submitDonation))
      .post("/submit")
      .send({ donationId: tx._id.toString(), signedXdr: "RAW_XDR", requestSponsorship: true });

    expect(res.statusCode).toBe(429);
    expect(res.body.retryUnsponsored).toBe(true);
    expect(tx.status).toBe("pending");
    expect(tx.save).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
  });
});
