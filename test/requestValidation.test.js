import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import logger from "../src/config/logger.js";

const controller = (name) =>
  jest.fn((_req, res) => res.status(200).json({ handler: name }));

const authHandlers = {
  registerUser: controller("register"),
  loginUser: controller("login"),
  refreshSession: controller("refresh"),
  getSessions: controller("sessions"),
  revokeSession: controller("revokeSession"),
  revokeAllOtherSessions: controller("revokeAllOtherSessions"),
  logoutUser: controller("logout"),
  requestPasswordReset: controller("requestPasswordReset"),
  resetPassword: controller("resetPassword"),
  changePassword: controller("changePassword"),
  verifyEmail: controller("verifyEmail"),
  resendVerification: controller("resendVerification"),
  setup2FA: controller("setup2FA"),
  verify2FA: controller("verify2FA"),
  disable2FA: controller("disable2FA"),
};

const paymentHandlers = {
  initializePayment: controller("initialize"),
  submitPayment: controller("submit"),
  getQuote: controller("quote"),
  getPaymentPreflight: controller("preflight"),
  getTransactionHistory: controller("history"),
  getTransaction: controller("transaction"),
  cancelTransaction: controller("cancel"),
};

const refundHandlers = {
  requestRefund: controller("requestRefund"),
  buildRefundXdr: controller("buildRefundXdr"),
  submitRefund: controller("submitRefund"),
  rejectRefund: controller("rejectRefund"),
  escalateDispute: controller("escalateDispute"),
  arbitrateDispute: controller("arbitrateDispute"),
};

const walletHandlers = {
  connectWallet: controller("connect"),
  disconnectWallet: controller("disconnect"),
  getWalletBalance: controller("balance"),
  getMyWallet: controller("me"),
  checkUserWallet: controller("check"),
};

jest.unstable_mockModule("../src/controllers/authController.js", () => authHandlers);
jest.unstable_mockModule("../src/controllers/stellar/sep10Controller.js", () => ({
  getStellarChallenge: controller("stellarChallenge"),
  verifyStellarChallenge: controller("stellarVerify"),
}));
jest.unstable_mockModule("../src/controllers/stellar/paymentController.js", () => paymentHandlers);
jest.unstable_mockModule("../src/controllers/stellar/refundController.js", () => refundHandlers);
jest.unstable_mockModule("../src/controllers/stellar/reconciliationController.js", () => ({
  reconciliationStatus: controller("reconciliationStatus"),
}));
jest.unstable_mockModule("../src/controllers/stellar/walletController.js", () => walletHandlers);
jest.unstable_mockModule("../src/middlewares/authMiddleware.js", () => ({
  protect: (req, _res, next) => {
    req.user = { _id: new mongoose.Types.ObjectId(), role: "student" };
    next();
  },
  authorizeRoles: () => (_req, _res, next) => next(),
}));
jest.unstable_mockModule("../src/middlewares/security.js", () => {
  const passThrough = (_req, _res, next) => next();
  return {
    refreshLimiter: passThrough,
    twoFactorLimiter: passThrough,
    emailAuthLimiter: passThrough,
    captchaGate: () => passThrough,
  };
});
jest.unstable_mockModule("../src/middlewares/idempotency.js", () => ({
  idempotency: () => (_req, _res, next) => next(),
}));

const authRoutes = (await import("../src/routes/authRoutes.js")).default;
const paymentRoutes = (await import("../src/routes/stellar/paymentRoutes.js")).default;
const walletRoutes = (await import("../src/routes/stellar/walletRoutes.js")).default;

const mount = (path, router) => {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  app.use(errorHandler);
  return app;
};

const expectValidationError = (res, expectedErrors) => {
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({
    success: false,
    status: "fail",
    message: "Validation failed",
    data: null,
  });
  expect(res.body.errors).toEqual(
    expect.arrayContaining(
      expectedErrors.map(([field, message]) => ({ field, message }))
    )
  );
};

describe("Request validation", () => {
  beforeEach(() => {
    Object.values(authHandlers)
      .concat(Object.values(paymentHandlers), Object.values(walletHandlers))
      .forEach((handler) => handler.mockClear());
  });

  it("rejects malformed registration data with field-level errors", async () => {
    const res = await request(mount("/auth", authRoutes))
      .post("/auth/register")
      .send({
        name: " ",
        email: "not-an-email",
        password: "short",
        role: "moderator",
      });

    expectValidationError(res, [
      ["name", "Name is required"],
      ["email", "Email must be a valid email address"],
      ["password", "Password must be at least 8 characters"],
      ["role", "Role must be one of: student, mentor, admin"],
    ]);
    expect(authHandlers.registerUser).not.toHaveBeenCalled();
  });

  it("normalizes valid registration email addresses", async () => {
    const res = await request(mount("/auth", authRoutes))
      .post("/auth/register")
      .send({
        name: "Test User",
        email: "USER@EXAMPLE.COM",
        password: "Qx7#vLmp92Zt",
        role: "student",
      });

    expect(res.status).toBe(200);
    expect(authHandlers.registerUser).toHaveBeenCalledTimes(1);
    expect(authHandlers.registerUser.mock.calls[0][0].body.email).toBe(
      "user@example.com"
    );
  });

  it("rejects malformed login data before the controller runs", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const res = await request(mount("/auth", authRoutes))
      .post("/auth/login?password=query-secret")
      .send({ email: "invalid", password: " " });

    expectValidationError(res, [
      ["email", "Email must be a valid email address"],
      ["password", "Password is required"],
    ]);
    expect(JSON.stringify(warnSpy.mock.calls)).toContain("/auth/login");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("query-secret");
    expect(authHandlers.loginUser).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("rejects invalid payment initialization fields before database access", async () => {
    const res = await request(mount("/payment", paymentRoutes))
      .post("/payment/initialize")
      .send({
        itemType: "video",
        itemId: "not-an-object-id",
        buyerWallet: "not-a-stellar-key",
      });

    expectValidationError(res, [
      ["itemType", "itemType must be one of: book, course"],
      ["itemId", "itemId must be a valid Mongo ObjectId"],
      ["buyerWallet", "buyerWallet must be a valid Stellar public key"],
    ]);
    expect(paymentHandlers.initializePayment).not.toHaveBeenCalled();
  });

  it("rejects invalid transaction IDs and signed XDR before submission", async () => {
    const res = await request(mount("/payment", paymentRoutes))
      .post("/payment/submit")
      .send({
        transactionId: "not-an-object-id",
        signedXdr: "not-an-xdr",
      });

    expectValidationError(res, [
      ["transactionId", "transactionId must be a valid Mongo ObjectId"],
      ["signedXdr", "signedXdr must be a well-formed Stellar transaction XDR"],
    ]);
    expect(paymentHandlers.submitPayment).not.toHaveBeenCalled();
  });

  it("rejects missing and malformed wallet public keys", async () => {
    const missing = await request(mount("/wallet", walletRoutes))
      .post("/wallet/connect")
      .send({});
    expectValidationError(missing, [["publicKey", "publicKey is required"]]);

    const malformed = await request(mount("/wallet", walletRoutes))
      .post("/wallet/connect")
      .send({ publicKey: "not-a-stellar-key" });
    expectValidationError(malformed, [
      ["publicKey", "publicKey must be a valid Stellar public key"],
    ]);

    expect(walletHandlers.connectWallet).not.toHaveBeenCalled();
  });
});
