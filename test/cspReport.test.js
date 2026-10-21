import { jest } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import CspViolation from "../src/models/CspViolation.js";
import User from "../src/models/User.js";
import { helmetMiddleware } from "../src/middlewares/security.js";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";
const token = (id) =>
  jwt.sign({ userId: id, sessionId: "s", is2FAVerified: true }, JWT_SECRET, { expiresIn: "5m" });

const legacy = {
  "csp-report": {
    "document-uri": "https://app.example.com/page?token=secret#frag",
    "violated-directive": "script-src",
    "effective-directive": "script-src",
    "blocked-uri": "https://evil.example/x.js?a=1",
    "source-file": "https://app.example.com/main.js",
    "line-number": 42,
  },
};

describe("CSP report endpoint (#140)", () => {
  let upsert;
  beforeEach(() => {
    upsert = jest.spyOn(CspViolation, "findOneAndUpdate").mockResolvedValue({});
  });
  afterEach(() => jest.restoreAllMocks());

  it("204 on legacy application/csp-report and upserts with counter", async () => {
    const res = await request(app)
      .post("/api/security/csp-report")
      .set("Content-Type", "application/csp-report")
      .set("User-Agent", "TestBrowser/1.0")
      .send(JSON.stringify(legacy));
    expect(res.status).toBe(204);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [filter, update] = upsert.mock.calls[0];
    expect(filter).toEqual({
      violatedDirective: "script-src",
      blockedUri: "https://evil.example/x.js",
      documentOrigin: "https://app.example.com",
    });
    expect(update.$inc).toEqual({ count: 1 });
    expect(update.$set.userAgent).toBe("TestBrowser/1.0");
    expect(update.$set.documentUri).toBe("https://app.example.com/page");
  });

  it("204 on application/reports+json", async () => {
    const res = await request(app)
      .post("/api/security/csp-report")
      .set("Content-Type", "application/reports+json")
      .send(
        JSON.stringify([
          { type: "csp-violation", body: { documentURL: "https://a.test/x", effectiveDirective: "img-src", blockedURL: "inline", lineNumber: 3 } },
          { type: "deprecation", body: {} },
        ]),
      );
    expect(res.status).toBe(204);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].violatedDirective).toBe("img-src");
  });

  it("truncates oversized strings", async () => {
    const big = "x".repeat(5000);
    const body = { "csp-report": { ...legacy["csp-report"], "violated-directive": big, "source-file": "https://a.test/" + big } };
    const res = await request(app)
      .post("/api/security/csp-report")
      .set("Content-Type", "application/csp-report")
      .send(JSON.stringify(body));
    expect(res.status).toBe(204);
    const [filter, update] = upsert.mock.calls[0];
    expect(filter.violatedDirective.length).toBe(100);
    expect(update.$set.sourceFile.length).toBeLessThanOrEqual(512);
  });

  it("stays 204 for malformed, oversized, empty or non-report bodies and DB errors", async () => {
    const post = () => request(app).post("/api/security/csp-report");
    expect((await post().set("Content-Type", "application/csp-report").send("{not json")).status).toBe(204);
    expect((await post().set("Content-Type", "application/csp-report").send(JSON.stringify({ a: "y".repeat(20000) }))).status).toBe(204);
    expect((await post().set("Content-Type", "application/csp-report").send(JSON.stringify({ foo: 1 }))).status).toBe(204);
    expect((await post()).status).toBe(204);
    expect(upsert).not.toHaveBeenCalled();
    upsert.mockRejectedValue(new Error("db down"));
    expect(
      (await post().set("Content-Type", "application/csp-report").send(JSON.stringify(legacy))).status,
    ).toBe(204);
  });

  it("helmet CSP advertises report-uri", async () => {
    const headers = {};
    await new Promise((resolve) =>
      helmetMiddleware({ headers: {} }, { setHeader: (k, v) => (headers[k] = v), removeHeader() {}, getHeader() {} }, resolve),
    );
    expect(headers["Content-Security-Policy"]).toContain("report-uri /api/security/csp-report");
  });

  describe("GET /stats", () => {
    const mockUser = (role) =>
      jest.spyOn(User, "findById").mockReturnValue({
        select: async () => ({ _id: "u1", role, twoFactor: { enabled: true } }),
      });

    it("401 without token", async () => {
      expect((await request(app).get("/api/security/csp-report/stats")).status).toBe(401);
    });

    it("403 for non-admin", async () => {
      mockUser("student");
      const res = await request(app)
        .get("/api/security/csp-report/stats")
        .set("Authorization", `Bearer ${token("u1")}`);
      expect(res.status).toBe(403);
    });

    it("200 with aggregates for admin", async () => {
      mockUser("admin");
      jest
        .spyOn(CspViolation, "aggregate")
        .mockResolvedValueOnce([{ _id: "script-src", count: 7 }])
        .mockResolvedValueOnce([{ _id: "https://evil.example/x.js", count: 7 }])
        .mockResolvedValueOnce([{ _id: null, total: 7, distinct: 1 }]);
      const res = await request(app)
        .get("/api/security/csp-report/stats?days=3")
        .set("Authorization", `Bearer ${token("u1")}`);
      expect(res.status).toBe(200);
      expect(res.body.data.windowDays).toBe(3);
      expect(res.body.data.topDirectives).toEqual([{ directive: "script-src", count: 7 }]);
      expect(res.body.data.totalViolations).toBe(7);
    });
  });
});
