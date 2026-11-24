import { jest } from "@jest/globals";
import request from "supertest";
import app from "../app.js";
import CspViolation from "../src/models/CspViolation.js";
import logger from "../src/config/logger.js";
import { hashIdentifier } from "../src/controllers/cspReportController.js";

const legacyBody = {
  "csp-report": {
    "document-uri": "https://app.example.com/page?token=secret#x",
    "violated-directive": "script-src",
    "effective-directive": "script-src",
    "blocked-uri": "https://evil.example/x.js",
  },
};

/**
 * Issue #647 — CSP reports are unauthenticated, attacker-controlled telemetry.
 * Raw client identifiers must not be persisted or logged.
 */
describe("CSP violation telemetry minimization (#647)", () => {
  let upsert;

  beforeEach(() => {
    upsert = jest.spyOn(CspViolation, "findOneAndUpdate").mockResolvedValue({});
  });

  afterEach(() => jest.restoreAllMocks());

  it("never persists the raw IP or user agent", async () => {
    const res = await request(app)
      .post("/api/security/csp-report")
      .set("Content-Type", "application/csp-report")
      .set("User-Agent", "PrivacyProbe/9.9")
      .send(JSON.stringify(legacyBody));

    expect(res.status).toBe(204);

    const [, update] = upsert.mock.calls[0];
    const persisted = JSON.stringify(update);

    expect(persisted).not.toContain("PrivacyProbe");
    expect(persisted).not.toContain("127.0.0.1");
    expect(update.$set.ip).toBeUndefined();
    expect(update.$set.userAgent).toBeUndefined();
    expect(update.$set.ipHash).toMatch(/^[0-9a-f]{16}$/);
    expect(update.$set.userAgentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("never logs the raw IP or user agent", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});

    await request(app)
      .post("/api/security/csp-report")
      .set("Content-Type", "application/csp-report")
      .set("User-Agent", "PrivacyProbe/9.9")
      .send(JSON.stringify(legacyBody));

    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.map((call) => call.join(" ")).join(" ");
    expect(logged).not.toContain("PrivacyProbe");
    expect(logged).not.toContain("127.0.0.1");
    expect(logged).toContain("script-src");
  });

  it("hashes the same client identically within one day", () => {
    const morning = new Date("2026-11-23T02:00:00.000Z");
    const evening = new Date("2026-11-23T22:00:00.000Z");

    expect(hashIdentifier("203.0.113.7", morning)).toBe(hashIdentifier("203.0.113.7", evening));
    expect(hashIdentifier("203.0.113.7", morning)).not.toBe(hashIdentifier("203.0.113.8", morning));
  });

  it("rotates the hash across days so clients cannot be tracked long-term", () => {
    const dayOne = new Date("2026-11-23T10:00:00.000Z");
    const dayTwo = new Date("2026-11-24T10:00:00.000Z");

    expect(hashIdentifier("203.0.113.7", dayOne)).not.toBe(hashIdentifier("203.0.113.7", dayTwo));
  });

  it("returns an empty hash for an absent identifier and never the raw value", () => {
    expect(hashIdentifier("", new Date("2026-11-23T10:00:00.000Z"))).toBe("");
    const hashed = hashIdentifier("203.0.113.7", new Date("2026-11-23T10:00:00.000Z"));
    expect(hashed).toHaveLength(16);
    expect(hashed).not.toContain("203");
  });

  it("still aggregates one document per violation pattern regardless of client", async () => {
    await request(app)
      .post("/api/security/csp-report")
      .set("Content-Type", "application/csp-report")
      .set("User-Agent", "PrivacyProbe/9.9")
      .send(JSON.stringify(legacyBody));

    await request(app)
      .post("/api/security/csp-report")
      .set("Content-Type", "application/csp-report")
      .set("User-Agent", "AnotherAgent/1.0")
      .send(JSON.stringify(legacyBody));

    const [firstFilter] = upsert.mock.calls[0];
    const [secondFilter] = upsert.mock.calls[1];
    expect(secondFilter).toEqual(firstFilter);
    expect(upsert.mock.calls[1][1].$inc).toEqual({ count: 1 });
  });
});
