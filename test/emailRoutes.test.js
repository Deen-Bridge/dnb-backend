import { jest } from "@jest/globals";
import request from "supertest";
import app from "../app.js";
import logger from "../src/config/logger.js";

// SENDLIB_API_KEY/URL are stripped by test/jest.setup.js, so in the test env
// sendMail logs the email body via [EMAIL LOG] instead of delivering. That lets
// us inspect the generated OTP. (Bodies are never logged in dev/prod.)

const extractOtpFromLog = (logCalls) => {
  const emailLog = logCalls
    .map((call) => call[0])
    .find((msg) => typeof msg === "string" && msg.includes("[EMAIL LOG]"));
  const match = emailLog && emailLog.match(/#166534;">(\d+)<\/span>/);
  return match ? match[1] : null;
};

describe("OTP email route", () => {
  let loggerInfoSpy;

  beforeAll(() => {
    loggerInfoSpy = jest.spyOn(logger, "info");
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("generates a fresh OTP per request (no shared module-level code)", async () => {
    const res1 = await request(app).post("/api/email").send({ email: "one@example.com" });
    const res2 = await request(app).post("/api/email").send({ email: "two@example.com" });

    expect(res1.statusCode).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res2.statusCode).toBe(200);

    const otp1 = extractOtpFromLog(loggerInfoSpy.mock.calls);
    // Logs accumulate across requests; take the last two [EMAIL LOG] entries.
    const calls = loggerInfoSpy.mock.calls.map((c) => c[0]);
    const emailLogs = calls.filter((m) => typeof m === "string" && m.includes("[EMAIL LOG]"));
    const otp2 = emailLogs.length >= 2
      ? (emailLogs[emailLogs.length - 1].match(/#166534;">(\d+)<\/span>/) || [])[1]
      : null;

    expect(otp1).toBeDefined();
    expect(otp2).toBeDefined();
    expect(otp1).toHaveLength(6);
    expect(otp2).toHaveLength(6);
    expect(otp1).not.toBe(otp2);
  });

  it("never returns the OTP in the response body", async () => {
    const res = await request(app).post("/api/email").send({ email: "safe@example.com" });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).not.toHaveProperty("otp");
  });

  it("rejects missing or non-string email", async () => {
    const missing = await request(app).post("/api/email").send({});
    expect(missing.statusCode).toBe(400);

    const invalid = await request(app).post("/api/email").send({ email: 12345 });
    expect(invalid.statusCode).toBe(400);
  });
});
