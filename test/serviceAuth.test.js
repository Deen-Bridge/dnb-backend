import crypto from "crypto";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import AuditLog, { AUDIT_ACTIONS } from "../src/models/AuditLog.js";

// ── Independent client-side signer ──────────────────────────────────────────
// Deliberately reimplements the canonical form from docs/service-to-service-auth.md
// (rather than importing the middleware's helper) so this test doubles as proof
// that the dnb-ai client can reproduce the exact signature from the spec.
const WHOAMI_PATH = "/api/internal/ai/whoami";

function sha256hex(input) {
  return crypto.createHash("sha256").update(input || "").digest("hex");
}

function signGet({ path = WHOAMI_PATH, secret, kid, serviceId = "dnb-ai", timestamp, body = "" }) {
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  const canonical = ["GET", path, ts, sha256hex(body)].join("\n");
  const signature = crypto.createHmac("sha256", secret).update(canonical).digest("hex");
  return {
    "X-Service-Id": serviceId,
    "X-Service-Key-Id": kid,
    "X-Timestamp": ts,
    "X-Signature": signature,
  };
}

const K1_SECRET = "k1-super-long-random-secret-value-0123456789";
const K2_SECRET = "k2-super-long-random-secret-value-9876543210";

const KEYS_K1 = JSON.stringify([
  { kid: "k1", secret: K1_SECRET, scopes: ["ai:read-content"], active: true },
]);

const KEYS_K1_K2_ACTIVE = JSON.stringify([
  { kid: "k1", secret: K1_SECRET, scopes: ["ai:read-content"], active: true },
  { kid: "k2", secret: K2_SECRET, scopes: ["ai:read-content"], active: true },
]);

const KEYS_K1_RETIRED = JSON.stringify([
  { kid: "k1", secret: K1_SECRET, scopes: ["ai:read-content"], active: false },
  { kid: "k2", secret: K2_SECRET, scopes: ["ai:read-content"], active: true },
]);

// A key that authenticates but lacks the route's scope.
const KEYS_WRONG_SCOPE = JSON.stringify([
  { kid: "k1", secret: K1_SECRET, scopes: ["ai:write-answers"], active: true },
]);

let mongoServer;
const originalKeys = process.env.AI_SERVICE_KEYS;
const originalJobsToken = process.env.JOBS_DASHBOARD_TOKEN;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  // Warm up the auditlogs collection so its indexes are built now (the first
  // write to a fresh in-memory collection can take ~700ms). This keeps the
  // later fire-and-forget denial write fast enough to observe within the poll.
  await AuditLog.create({ action: AUDIT_ACTIONS.AUTH_LOGOUT, status: "success" });
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  if (originalKeys === undefined) delete process.env.AI_SERVICE_KEYS;
  else process.env.AI_SERVICE_KEYS = originalKeys;
  if (originalJobsToken === undefined) delete process.env.JOBS_DASHBOARD_TOKEN;
  else process.env.JOBS_DASHBOARD_TOKEN = originalJobsToken;
});

beforeEach(() => {
  process.env.AI_SERVICE_KEYS = KEYS_K1;
});

describe("requireServiceAuth via /api/internal/ai/whoami", () => {
  it("accepts a valid signed request with a permitted scope and reflects req.service", async () => {
    const headers = signGet({ secret: K1_SECRET, kid: "k1" });
    const res = await request(app).get(WHOAMI_PATH).set(headers);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.service).toEqual({
      id: "dnb-ai",
      kid: "k1",
      scopes: ["ai:read-content"],
    });
  });

  it("rejects a request with no signature headers (401)", async () => {
    const res = await request(app).get(WHOAMI_PATH);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rejects a bad/forged signature (401)", async () => {
    const headers = signGet({ secret: "the-wrong-secret", kid: "k1" });
    const res = await request(app).get(WHOAMI_PATH).set(headers);
    expect(res.status).toBe(401);
  });

  it("rejects an unknown kid (401)", async () => {
    const headers = signGet({ secret: K1_SECRET, kid: "does-not-exist" });
    const res = await request(app).get(WHOAMI_PATH).set(headers);
    expect(res.status).toBe(401);
  });

  it("rejects a wrong scope with 403", async () => {
    process.env.AI_SERVICE_KEYS = KEYS_WRONG_SCOPE;
    const headers = signGet({ secret: K1_SECRET, kid: "k1" });
    const res = await request(app).get(WHOAMI_PATH).set(headers);
    expect(res.status).toBe(403);
  });

  it("rejects a replayed (stale-timestamp) request with 401", async () => {
    const stale = Math.floor(Date.now() / 1000) - 600; // outside ±300s window
    const headers = signGet({ secret: K1_SECRET, kid: "k1", timestamp: stale });
    const res = await request(app).get(WHOAMI_PATH).set(headers);
    expect(res.status).toBe(401);
  });

  it("rejects a future-dated timestamp with 401", async () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    const headers = signGet({ secret: K1_SECRET, kid: "k1", timestamp: future });
    const res = await request(app).get(WHOAMI_PATH).set(headers);
    expect(res.status).toBe(401);
  });

  it("does not throw on a length-mismatched signature (constant-time safe → 401)", async () => {
    const headers = signGet({ secret: K1_SECRET, kid: "k1" });
    headers["X-Signature"] = "abc123"; // shorter than a real 64-char hex digest
    const res = await request(app).get(WHOAMI_PATH).set(headers);
    expect(res.status).toBe(401); // 401, never a 500 from timingSafeEqual throwing
  });
});

describe("key rotation without downtime", () => {
  it("accepts two active kids simultaneously, then rejects the retired one while the other still works", async () => {
    // Both k1 and k2 active → both valid.
    process.env.AI_SERVICE_KEYS = KEYS_K1_K2_ACTIVE;

    const r1 = await request(app)
      .get(WHOAMI_PATH)
      .set(signGet({ secret: K1_SECRET, kid: "k1" }));
    expect(r1.status).toBe(200);
    expect(r1.body.service.kid).toBe("k1");

    const r2 = await request(app)
      .get(WHOAMI_PATH)
      .set(signGet({ secret: K2_SECRET, kid: "k2" }));
    expect(r2.status).toBe(200);
    expect(r2.body.service.kid).toBe("k2");

    // Retire k1 (active:false), keep k2.
    process.env.AI_SERVICE_KEYS = KEYS_K1_RETIRED;

    const r1Retired = await request(app)
      .get(WHOAMI_PATH)
      .set(signGet({ secret: K1_SECRET, kid: "k1" }));
    expect(r1Retired.status).toBe(401);

    const r2Still = await request(app)
      .get(WHOAMI_PATH)
      .set(signGet({ secret: K2_SECRET, kid: "k2" }));
    expect(r2Still.status).toBe(200);
  });
});

describe("audit trail for denied S2S attempts", () => {
  it("writes a service_auth.denied AuditLog row (status failure) on denial", async () => {
    // Use a distinctive kid so we assert on THIS request's audit row, not one
    // left by an earlier denial test. AuditLog is append-only (no deleteMany).
    process.env.AI_SERVICE_KEYS = JSON.stringify([
      { kid: "audit-kid", secret: K1_SECRET, scopes: ["ai:read-content"], active: true },
    ]);

    const headers = signGet({ secret: "wrong-secret", kid: "audit-kid" });
    const res = await request(app).get(WHOAMI_PATH).set(headers);
    expect(res.status).toBe(401);

    // recordAudit is fire-and-forget (microtask) — poll briefly for the row.
    let row = null;
    for (let i = 0; i < 40 && !row; i++) {
      row = await AuditLog.findOne({
        action: "service_auth.denied",
        "metadata.kid": "audit-kid",
      });
      if (!row) await new Promise((r) => setTimeout(r, 50));
    }

    expect(row).not.toBeNull();
    expect(row.status).toBe("failure");
    expect(row.targetType).toBe("Service");
    expect(row.metadata?.kid).toBe("audit-kid");
    expect(row.metadata?.scope).toBe("ai:read-content");
  });
});

describe("/admin/jobs timing-safe token comparison", () => {
  const TOKEN = "jobs-dashboard-token-abcdefghijklmnop";

  beforeEach(() => {
    process.env.JOBS_DASHBOARD_TOKEN = TOKEN;
  });

  it("allows the correct bearer token", async () => {
    const res = await request(app)
      .get("/admin/jobs")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Accept", "application/json");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects a wrong token of equal length with 401", async () => {
    const wrong = "Bearer " + "x".repeat(TOKEN.length);
    const res = await request(app)
      .get("/admin/jobs")
      .set("Authorization", wrong)
      .set("Accept", "application/json");
    expect(res.status).toBe(401);
  });

  it("does not throw on a length-mismatched token (constant-time safe → 401)", async () => {
    const res = await request(app)
      .get("/admin/jobs")
      .set("Authorization", "Bearer short")
      .set("Accept", "application/json");
    expect(res.status).toBe(401); // not a 500
  });
});
