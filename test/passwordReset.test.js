import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import axios from "axios";
import app from "../app.js";
import User from "../src/models/User.js";
import Session from "../src/models/Session.js";

const testUser = {
  name: "Reset User",
  email: "reset_user@example.com",
  password: "oldPassword123",
  role: "student",
};

describe("Password Reset Flow", () => {
  let usersStore = [];
  let sessionsStore = [];
  let axiosSpy;

  beforeAll(() => {
    // Mock axios to prevent network calls during tests
    axiosSpy = jest.spyOn(axios, "post").mockResolvedValue({ status: 200, statusText: "OK", data: {} });

    // Mock User methods
    jest.spyOn(User, "findOne").mockImplementation((query) => {
      const email = query?.email;
      const found = usersStore.find((u) => u.email === email);
      return {
        select: () => found || null,
        then: (resolve) => resolve(found || null),
      };
    });

    jest.spyOn(User, "findById").mockImplementation((id) => {
      const found = usersStore.find((u) => u._id.toString() === id.toString());
      return {
        select: () => found || null,
        then: (resolve) => resolve(found || null),
      };
    });

    jest.spyOn(User, "create").mockImplementation(async (data) => {
      const _id = new mongoose.Types.ObjectId().toString();
      const newUser = {
        _id,
        ...data,
        save: async function () { return this; },
      };
      usersStore.push(newUser);
      return newUser;
    });

    jest.spyOn(User, "deleteMany").mockImplementation(async () => {
      usersStore = [];
      return { acknowledged: true };
    });

    // Mock Session methods
    jest.spyOn(Session, "create").mockImplementation(async (data) => {
      const _id = new mongoose.Types.ObjectId().toString();
      const newSession = {
        _id,
        revokedAt: null,
        replacedBy: null,
        lastUsedAt: new Date(),
        ...data,
        save: async function () { return this; },
      };
      sessionsStore.push(newSession);
      return newSession;
    });

    jest.spyOn(Session, "findOne").mockImplementation((query) => {
      let found = null;
      if (query.refreshTokenHash) {
        found = sessionsStore.find((s) => s.refreshTokenHash === query.refreshTokenHash);
      } else if (query._id) {
        found = sessionsStore.find((s) => s._id.toString() === query._id.toString());
      }
      return {
        populate: () => found || null,
        then: (resolve) => resolve(found || null),
      };
    });
  });

  beforeEach(() => {
    usersStore = [];
    sessionsStore = [];
    if (axiosSpy) axiosSpy.mockClear();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const getSentOtpFromAxios = () => {
    const emailCalls = axiosSpy.mock.calls.filter(
      (call) => call[1]?.template_params?.otp !== undefined
    );
    const lastCall = emailCalls[emailCalls.length - 1];
    return lastCall ? lastCall[1].template_params.otp : null;
  };

  it("should request password reset without exposing OTP in response body", async () => {
    await request(app).post("/api/auth/register").send(testUser);

    const res = await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: testUser.email });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain("If an account exists");
    expect(res.body).not.toHaveProperty("otp");

    const sentOtp = getSentOtpFromAxios();
    expect(sentOtp).toBeDefined();
    expect(typeof sentOtp).toBe("string");

    // Verify resetTokenHash and resetTokenExpiry stored on user
    const dbUser = usersStore.find((u) => u.email === testUser.email);
    expect(dbUser.resetTokenHash).toBeDefined();
    expect(dbUser.resetTokenExpiry).toBeDefined();
  });

  it("should return generic message when requesting reset for non-existent email (anti-enumeration)", async () => {
    const res = await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: "nonexistent@example.com" });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain("If an account exists");
    expect(res.body).not.toHaveProperty("otp");
  });

  it("should reject password reset with wrong OTP", async () => {
    await request(app).post("/api/auth/register").send(testUser);
    await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: testUser.email });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: testUser.email,
        otp: "000000",
        newPassword: "newSecurePassword123",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("Invalid or expired OTP");
  });

  it("should reject password reset with expired OTP", async () => {
    await request(app).post("/api/auth/register").send(testUser);
    await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: testUser.email });

    const sentOtp = getSentOtpFromAxios();
    const dbUser = usersStore.find((u) => u.email === testUser.email);
    // Artificially expire the token
    dbUser.resetTokenExpiry = new Date(Date.now() - 1000);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: testUser.email,
        otp: sentOtp,
        newPassword: "newSecurePassword123",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("Invalid or expired OTP");
  });

  it("should successfully reset password with valid OTP and clear token (single use)", async () => {
    await request(app).post("/api/auth/register").send(testUser);
    await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: testUser.email });

    const sentOtp = getSentOtpFromAxios();
    const newPassword = "newSecurePassword123";

    // Successful reset
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: testUser.email,
        otp: sentOtp,
        newPassword,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain("Password reset successful");

    // Token fields cleared from user
    const dbUser = usersStore.find((u) => u.email === testUser.email);
    expect(dbUser.resetTokenHash).toBeUndefined();
    expect(dbUser.resetTokenExpiry).toBeUndefined();

    // Verify bcrypt cost factor 12 was used
    const passwordHash = dbUser.password;
    expect(passwordHash.startsWith("$2b$12$") || passwordHash.startsWith("$2a$12$")).toBe(true);

    // Verify user can now login with new password
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testUser.email, password: newPassword });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.body.success).toBe(true);

    // Reused OTP attempt should be rejected
    const reuseRes = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: testUser.email,
        otp: sentOtp,
        newPassword: "anotherPassword123",
      });

    expect(reuseRes.statusCode).toBe(400);
    expect(reuseRes.body.message).toContain("Invalid or expired OTP");
  });
});
