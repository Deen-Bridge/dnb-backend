import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import { errorHandler } from "../src/middlewares/errorHandler.js";

const ok = (name) => jest.fn((_req, res) => res.status(200).json({ handler: name }));
const names = [
  "registerUser", "loginUser", "refreshSession", "getSessions", "revokeSession",
  "revokeAllOtherSessions", "logoutUser", "requestPasswordReset", "resetPassword",
  "changePassword", "verifyEmail", "resendVerification", "setup2FA", "verify2FA",
  "disable2FA",
];
const handlers = Object.fromEntries(names.map((n) => [n, ok(n)]));

jest.unstable_mockModule("../src/controllers/authController.js", () => handlers);
jest.unstable_mockModule("../src/controllers/stellar/sep10Controller.js", () => ({
  getStellarChallenge: ok("stellarChallenge"),
  verifyStellarChallenge: ok("stellarVerify"),
}));
jest.unstable_mockModule("../src/controllers/googleAuthController.js", () => ({
  googleSignIn: ok("googleSignIn"),
}));
jest.unstable_mockModule("../src/middlewares/authMiddleware.js", () => ({
  protect: (req, _res, next) => {
    req.user = { _id: new mongoose.Types.ObjectId(), role: "student" };
    next();
  },
}));
jest.unstable_mockModule("../src/middlewares/security.js", () => {
  const pass = (_req, _res, next) => next();
  return {
    refreshLimiter: pass,
    twoFactorLimiter: pass,
    emailAuthLimiter: pass,
    captchaGate: () => pass,
  };
});

const authRoutes = (await import("../src/routes/authRoutes.js")).default;
const app = express();
app.use(express.json());
app.use("/auth", authRoutes);
app.use(errorHandler);

const email = "user@example.com";
const cases = [
  // [method, path, handler, valid body, invalid body, invalid field]
  ["post", "/auth/request-password-reset", "requestPasswordReset", { email }, { email: { $ne: "" } }, "email"],
  ["post", "/auth/reset-password", "resetPassword", { email, otp: "123456", newPassword: "x" }, { email, otp: "123456" }, "newPassword"],
  ["post", "/auth/resend-verification", "resendVerification", { email }, { email: "nope" }, "email"],
  ["post", "/auth/refresh", "refreshSession", { refreshToken: "abc" }, { refreshToken: { a: 1 } }, "refreshToken"],
  ["put", "/auth/change-password", "changePassword", { currentPassword: "a", newPassword: "b" }, { newPassword: "b" }, "currentPassword"],
  ["post", "/auth/2fa/verify", "verify2FA", { code: "123456", mfaToken: "t" }, { mfaToken: ["x"] }, "mfaToken"],
  ["post", "/auth/2fa/login", "verify2FA", { code: 123456, mfaToken: "t" }, { code: { $gt: "" } }, "code"],
  ["post", "/auth/2fa/disable", "disable2FA", { recoveryCode: "abcd" }, { recoveryCode: 5 }, "recoveryCode"],
  ["post", "/auth/stellar/verify", "stellarVerify", { transaction: "AAAA" }, {}, "transaction"],
  ["post", "/auth/google", "googleSignIn", { idToken: "AAAA" }, {}, "idToken"],
];

describe("auth route request validation", () => {
  beforeEach(() => {
    Object.values(handlers).forEach((h) => h.mockClear());
  });

  it.each(cases)("%s %s accepts a valid body", async (method, path, _h, valid) => {
    const res = await request(app)[method](path).send(valid);
    expect(res.status).toBe(200);
  });

  it.each(cases)("%s %s rejects an invalid body with 400", async (method, path, handler, _v, invalid, field) => {
    const res = await request(app)[method](path).send(invalid);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
    expect(res.body.errors.map((e) => e.field)).toContain(field);
    if (handlers[handler]) expect(handlers[handler]).not.toHaveBeenCalled();
  });

  it("refresh with no body (cookie mode) still reaches the controller", async () => {
    const res = await request(app).post("/auth/refresh").send({});
    expect(res.status).toBe(200);
    expect(handlers.refreshSession).toHaveBeenCalled();
  });

  it("does not modify password or email values", async () => {
    handlers.resetPassword.mockImplementationOnce((req, res) => res.json(req.body));
    const body = { email: "User@Example.com", otp: 123456, newPassword: "  Pa<b>ss  " };
    const res = await request(app).post("/auth/reset-password").send(body);
    expect(res.body).toEqual(body);
  });

  it("login still accepts a weak legacy password", async () => {
    const res = await request(app).post("/auth/login").send({ email, password: "a" });
    expect(res.status).toBe(200);
  });

  it("register rejects invalid input and login rejects a missing password", async () => {
    const reg = await request(app).post("/auth/register").send({ name: "A", email: "bad", password: "x" });
    expect(reg.status).toBe(400);
    const login = await request(app).post("/auth/login").send({ email });
    expect(login.status).toBe(400);
  });
});
