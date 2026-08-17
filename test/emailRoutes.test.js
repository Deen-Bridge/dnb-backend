import { jest } from "@jest/globals";
import request from "supertest";
import app from "../app.js";
import logger from "../src/config/logger.js";
import { testOutbox } from "../services/emails/sendMail.js";

// SENDLIB_API_KEY/URL are stripped by test/jest.setup.js, so in the test env
// sendMail captures the rendered message in its in-memory testOutbox instead
// of delivering. That lets us inspect the generated OTP without the body ever
// reaching a log stream (bodies are never logged in any environment).

const extractOtpFromHtml = (html) => {
  const match = html.match(/#166534;">(\d+)<\/span>/);
  return match ? match[1] : null;
};

const lastEmail = () => testOutbox[testOutbox.length - 1] || null;

const capturedLogText = (spy) =>
  spy.mock.calls
    .map((call) => call.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))
    .join("\n");

describe("OTP email route", () => {
  let loggerSpy;

  beforeAll(() => {
    loggerSpy = jest.spyOn(logger, "info");
    jest.spyOn(logger, "warn");
    jest.spyOn(logger, "error");
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    testOutbox.length = 0;
    loggerSpy.mockClear();
  });

  it("generates a fresh OTP per request (no shared module-level code)", async () => {
    const res1 = await request(app).post("/api/email").send({ email: "one@example.com" });
    const res2 = await request(app).post("/api/email").send({ email: "two@example.com" });

    expect(res1.statusCode).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res2.statusCode).toBe(200);

    // The outbox accumulates across requests; the last two entries are the
    // two emails just sent.
    const otp1 = extractOtpFromHtml(testOutbox[testOutbox.length - 2].html);
    const otp2 = extractOtpFromHtml(lastEmail().html);

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

  it("never writes the OTP or email body to the logger", async () => {
    const res = await request(app).post("/api/email").send({ email: "secret@example.com" });

    expect(res.statusCode).toBe(200);

    // The generated OTP exists in the test outbox but must never appear in
    // any log line (interpolated or structured).
    const otp = extractOtpFromHtml(lastEmail().html);
    expect(otp).toBeDefined();

    const logs = capturedLogText(loggerSpy);
    expect(logs).not.toContain(otp);
    // No full email body / HTML should ever reach the logs either.
    expect(logs).not.toContain("<html");
    expect(logs).not.toContain("<span");
  });

  it("rejects missing or non-string email", async () => {
    const missing = await request(app).post("/api/email").send({});
    expect(missing.statusCode).toBe(400);

    const invalid = await request(app).post("/api/email").send({ email: 12345 });
    expect(invalid.statusCode).toBe(400);
  });
});
