import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import IngestionCursor from "../src/models/IngestionCursor.js";
import Transaction from "../src/models/Transaction.js";
import UnreconciledPayment from "../src/models/UnreconciledPayment.js";
import {
  registry,
  refreshReconciliationHealth,
  setReconciliationHealthProvider,
} from "../src/config/metrics.js";
import {
  BACKLOG_SAMPLE_LIMIT,
  RECONCILIATION_STATUS_VERSION,
  deriveOverallState,
  describeCursor,
  getReconciliationStatus,
  redactIdentifier,
  registerReconciliationHealthMetrics,
  resolveThresholds,
} from "../src/services/stellar/reconciliationHealthService.js";
import { reconciliationStatus } from "../src/controllers/stellar/reconciliationController.js";

const PLATFORM = "GPLATFORMWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
const DONATION = "GDONATIONWALLETBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2";
const ENV = Object.freeze({
  PLATFORM_WALLET_PUBLIC_KEY: PLATFORM,
  DONATION_WALLET_PUBLIC_KEY: DONATION,
});
const NOW = new Date("2026-11-21T12:00:00.000Z");
const THRESHOLDS = resolveThresholds({});

const secondsAgo = (seconds) => new Date(NOW.getTime() - seconds * 1000);
const hash = (n) => n.toString(16).padStart(64, "a");

const freshCursor = (account, overrides = {}) => ({
  account,
  cursor: "123456-1",
  lastPollAt: secondsAgo(10),
  lastSuccessAt: secondsAgo(10),
  lastSyncAt: secondsAgo(10),
  consecutiveFailures: 0,
  workerId: "worker-host:4242:abcdef",
  leaseExpiresAt: new Date(NOW.getTime() + 60_000),
  ...overrides,
});

const unreconciled = (n, createdAt, overrides = {}) => ({
  stellarTxHash: hash(n),
  from: "GSENDERACCOUNTCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  to: PLATFORM,
  amount: "12.5000000",
  memo: "DNB-B-SECRETREFERENCE0000",
  sourceAccount: "GSENDERACCOUNTCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  reason: "No checkout was issued with this payment reference",
  reasonCode: "reference_not_found",
  referenceKind: "canonical",
  attempts: 2,
  lastSeenAt: createdAt,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

// Insert through the driver so createdAt is ours, not Mongoose's "now".
const insertUnreconciled = (rows) => UnreconciledPayment.collection.insertMany(rows);
const insertCursors = (rows) => IngestionCursor.collection.insertMany(rows);

const gaugeValue = async (name, labels = {}) => {
  const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name);
  const sample = metric?.values.find((v) =>
    Object.entries(labels).every(([key, value]) => v.labels[key] === value)
  );
  return sample?.value;
};

describe("reconciliation health: pure classification", () => {
  describe("resolveThresholds", () => {
    it("uses documented defaults", () => {
      expect(resolveThresholds({})).toEqual({
        cursorStaleAfterSeconds: 300,
        cursorStalledAfterSeconds: 1800,
        workerFailureThreshold: 3,
        backlogMaxAgeSeconds: 86400,
        backlogCountThreshold: 50,
        backlogGrowthPerHour: 10,
      });
    });

    it("accepts positive integer overrides and ignores invalid ones", () => {
      const thresholds = resolveThresholds({
        RECONCILIATION_CURSOR_STALE_SECONDS: "120",
        RECONCILIATION_WORKER_FAILURE_THRESHOLD: "-1",
        RECONCILIATION_BACKLOG_COUNT_THRESHOLD: "ten",
        RECONCILIATION_BACKLOG_MAX_AGE_SECONDS: "1.5",
      });
      expect(thresholds.cursorStaleAfterSeconds).toBe(120);
      expect(thresholds.workerFailureThreshold).toBe(3);
      expect(thresholds.backlogCountThreshold).toBe(50);
      expect(thresholds.backlogMaxAgeSeconds).toBe(86400);
    });

    it("never lets the stalled threshold undercut the stale one", () => {
      const thresholds = resolveThresholds({
        RECONCILIATION_CURSOR_STALE_SECONDS: "900",
        RECONCILIATION_CURSOR_STALLED_SECONDS: "60",
      });
      expect(thresholds.cursorStalledAfterSeconds).toBe(900);
    });
  });

  describe("redactIdentifier", () => {
    it("keeps a recognisable prefix and suffix only", () => {
      expect(redactIdentifier(PLATFORM)).toBe("GPLA…AAA1");
      expect(redactIdentifier(hash(7), { head: 6, tail: 4 })).toBe("aaaaaa…aaa7");
    });

    it("fully masks short values and handles empty input", () => {
      expect(redactIdentifier("GSHORT")).toBe("…");
      expect(redactIdentifier("")).toBeNull();
      expect(redactIdentifier(undefined)).toBeNull();
    });
  });

  describe("describeCursor", () => {
    const describeAt = (doc) =>
      describeCursor({ account: PLATFORM, role: "platform" }, doc, { now: NOW, thresholds: THRESHOLDS });

    it("reports a recently successful cursor as fresh with an active lease", () => {
      const result = describeAt(freshCursor(PLATFORM));
      expect(result).toMatchObject({
        role: "platform",
        account: "GPLA…AAA1",
        state: "fresh",
        secondsSinceLastSuccess: 10,
        consecutiveFailures: 0,
        lastError: null,
        worker: { state: "active" },
      });
    });

    it("reports a missing cursor", () => {
      const result = describeAt(null);
      expect(result.state).toBe("missing");
      expect(result.secondsSinceLastSuccess).toBeNull();
      expect(result.worker.state).toBe("unknown");
    });

    it("goes stale, then stalled, as the last success ages", () => {
      expect(describeAt(freshCursor(PLATFORM, { lastSuccessAt: secondsAgo(301) })).state).toBe("stale");
      expect(describeAt(freshCursor(PLATFORM, { lastSuccessAt: secondsAgo(1801) })).state).toBe("stalled");
    });

    it("treats the threshold itself as still within bounds", () => {
      expect(describeAt(freshCursor(PLATFORM, { lastSuccessAt: secondsAgo(300) })).state).toBe("fresh");
    });

    it("reports repeated failures while data is still fresh as failing", () => {
      const result = describeAt(
        freshCursor(PLATFORM, {
          consecutiveFailures: 3,
          lastErrorAt: secondsAgo(5),
          lastErrorCode: "horizon_unavailable",
        })
      );
      expect(result.state).toBe("failing");
      expect(result.lastError).toEqual({ code: "horizon_unavailable", at: secondsAgo(5).toISOString() });
    });

    it("falls back to lastSyncAt for cursors written before health tracking", () => {
      const legacy = { account: PLATFORM, cursor: "1", lastSyncAt: secondsAgo(30), createdAt: secondsAgo(9999) };
      const result = describeAt(legacy);
      expect(result.state).toBe("fresh");
      expect(result.lastSuccessAt).toBe(secondsAgo(30).toISOString());
      expect(result.worker.state).toBe("unknown");
    });

    it("ages a never-successful cursor from its creation time", () => {
      const neverSucceeded = { account: PLATFORM, cursor: "", createdAt: secondsAgo(2000), consecutiveFailures: 40 };
      const result = describeAt(neverSucceeded);
      expect(result.state).toBe("stalled");
      expect(result.lastSuccessAt).toBeNull();
    });

    it("reports a lapsed lease as expired", () => {
      const result = describeAt(freshCursor(PLATFORM, { leaseExpiresAt: secondsAgo(1) }));
      expect(result.worker.state).toBe("expired");
    });

    it("does not echo unknown error codes or raw cursor fields", () => {
      const result = describeAt(
        freshCursor(PLATFORM, { lastErrorAt: secondsAgo(1), lastErrorCode: "Error: connect to 10.0.0.7 failed" })
      );
      expect(result.lastError.code).toBe("unclassified");
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(PLATFORM);
      expect(serialized).not.toContain("123456-1");
      expect(serialized).not.toContain("worker-host");
      expect(serialized).not.toContain("10.0.0.7");
    });
  });

  describe("deriveOverallState", () => {
    const account = (state, extra = {}) => ({
      state,
      consecutiveFailures: 0,
      worker: { state: "active" },
      ...extra,
    });
    const quietBacklog = { unreconciledCount: 0, oldestAgeSeconds: null };
    const quietThroughput = { lastHour: { netBacklogChange: 0 } };
    const derive = (accounts, backlog = quietBacklog, throughput = quietThroughput) =>
      deriveOverallState({ accounts, backlog, throughput, thresholds: THRESHOLDS });

    it("is healthy when every account is fresh and the backlog is quiet", () => {
      expect(derive([account("fresh"), account("fresh")])).toEqual({ state: "healthy", reasons: [] });
    });

    it("is stalled when no accounts are configured", () => {
      expect(derive([])).toEqual({ state: "stalled", reasons: ["no_watched_accounts"] });
    });

    it("is stalled when an expected cursor is missing", () => {
      expect(derive([account("fresh"), account("missing")]).state).toBe("stalled");
    });

    it("is degraded when one account is stale and the other fresh (partial failure)", () => {
      expect(derive([account("fresh"), account("stale")])).toEqual({
        state: "degraded",
        reasons: ["cursor_stale"],
      });
    });

    it("keeps the worst state and every reason when signals mix", () => {
      const result = derive([
        account("stalled", { worker: { state: "expired" } }),
        account("failing", { consecutiveFailures: 5 }),
      ]);
      expect(result.state).toBe("stalled");
      expect(result.reasons).toEqual(["cursor_stalled", "worker_lease_expired", "worker_failing"]);
    });

    it("degrades on an aged, large or growing backlog but never stalls on it", () => {
      const result = derive(
        [account("fresh")],
        { unreconciledCount: 50, oldestAgeSeconds: 86401 },
        { lastHour: { netBacklogChange: 10 } }
      );
      expect(result).toEqual({
        state: "degraded",
        reasons: ["backlog_aged", "backlog_large", "backlog_growing"],
      });
    });
  });
});

describe("reconciliation health: status DTO", () => {
  let mongoServer;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    await Promise.all([
      IngestionCursor.syncIndexes(),
      Transaction.syncIndexes(),
      UnreconciledPayment.syncIndexes(),
    ]);
  }, 30000);

  afterAll(async () => {
    setReconciliationHealthProvider(null);
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([
      IngestionCursor.deleteMany({}),
      Transaction.deleteMany({}),
      UnreconciledPayment.deleteMany({}),
    ]);
  });

  const status = (env = ENV) => getReconciliationStatus({ now: NOW, env });

  it("returns a versioned, healthy DTO for fresh cursors and an empty backlog", async () => {
    await insertCursors([freshCursor(PLATFORM), freshCursor(DONATION)]);

    const result = await status();

    expect(result.version).toBe(RECONCILIATION_STATUS_VERSION);
    expect(result.generatedAt).toBe(NOW.toISOString());
    expect(result.state).toBe("healthy");
    expect(result.reasons).toEqual([]);
    expect(result.thresholds).toEqual(THRESHOLDS);
    expect(result.runbook).toMatch(/payment-reconciliation\.md#health-status-and-runbook$/);
    expect(result.ingestion.pollIntervalSeconds).toBe(30);
    expect(result.ingestion.accounts.map((a) => [a.role, a.state])).toEqual([
      ["platform", "fresh"],
      ["donation", "fresh"],
    ]);
    expect(result.backlog).toEqual({
      unreconciledCount: 0,
      byAge: { under1h: 0, from1hTo24h: 0, from24hTo7d: 0, over7d: 0 },
      oldestAgeSeconds: null,
      byReason: {},
      sampleLimit: BACKLOG_SAMPLE_LIMIT,
      sample: [],
    });
  });

  it("exposes a fixed set of keys, independent of the cursor schema", async () => {
    await insertCursors([freshCursor(PLATFORM, { someFutureInternalField: "x" }), freshCursor(DONATION)]);

    const result = await status();

    expect(Object.keys(result).sort()).toEqual(
      ["backlog", "generatedAt", "ingestion", "reasons", "runbook", "state", "thresholds", "throughput", "version"]
    );
    expect(Object.keys(result.ingestion.accounts[0]).sort()).toEqual(
      ["account", "consecutiveFailures", "lastError", "lastPollAt", "lastSuccessAt", "role",
        "secondsSinceLastSuccess", "state", "worker"]
    );
    const serialized = JSON.stringify(result);
    for (const leaked of ["_id", "__v", "cursor\"", "workerId", "someFutureInternalField", PLATFORM, DONATION]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("is stalled when a watched account has no cursor", async () => {
    await insertCursors([freshCursor(PLATFORM)]);

    const result = await status();

    expect(result.state).toBe("stalled");
    expect(result.reasons).toContain("cursor_missing");
    expect(result.ingestion.accounts[1]).toMatchObject({ role: "donation", state: "missing" });
  });

  it("is degraded when one account is stale and the other fresh", async () => {
    await insertCursors([
      freshCursor(PLATFORM),
      freshCursor(DONATION, {
        lastSuccessAt: secondsAgo(600),
        lastSyncAt: secondsAgo(600),
        lastPollAt: secondsAgo(5),
        consecutiveFailures: 20,
        lastErrorAt: secondsAgo(5),
        lastErrorCode: "horizon_unavailable",
      }),
    ]);

    const result = await status();

    expect(result.state).toBe("degraded");
    expect(result.reasons).toEqual(["cursor_stale", "worker_failing"]);
    expect(result.ingestion.accounts[1]).toMatchObject({
      state: "stale",
      secondsSinceLastSuccess: 600,
      consecutiveFailures: 20,
      lastError: { code: "horizon_unavailable" },
      worker: { state: "active" },
    });
  });

  it("is stalled when the worker stopped long ago", async () => {
    await insertCursors([
      freshCursor(PLATFORM, {
        lastSuccessAt: secondsAgo(3 * 86400),
        lastPollAt: secondsAgo(3 * 86400),
        leaseExpiresAt: secondsAgo(3 * 86400 - 120),
      }),
      freshCursor(DONATION),
    ]);

    const result = await status();

    expect(result.state).toBe("stalled");
    expect(result.reasons).toEqual(["cursor_stalled", "worker_lease_expired"]);
  });

  it("is stalled when no accounts are configured", async () => {
    const result = await status({});

    expect(result.state).toBe("stalled");
    expect(result.reasons).toEqual(["no_watched_accounts"]);
    expect(result.ingestion.accounts).toEqual([]);
  });

  it("counts cursors for unwatched accounts without listing them", async () => {
    await insertCursors([
      freshCursor(PLATFORM),
      freshCursor(DONATION),
      freshCursor("GOLDROTATEDWALLETDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"),
    ]);

    const result = await status();

    expect(result.ingestion.unwatchedCursorCount).toBe(1);
    expect(result.ingestion.accounts).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("GOLDROTATED");
  });

  it("buckets the open backlog by age and reports the oldest record", async () => {
    await insertCursors([freshCursor(PLATFORM), freshCursor(DONATION)]);
    await insertUnreconciled([
      unreconciled(1, secondsAgo(60)),
      unreconciled(2, secondsAgo(2 * 3600), { reasonCode: "amount_mismatch" }),
      unreconciled(3, secondsAgo(3 * 86400)),
      unreconciled(4, secondsAgo(10 * 86400), { reasonCode: undefined }),
      // Resolved rows are not backlog, however old.
      unreconciled(5, secondsAgo(30 * 86400), { resolvedAt: secondsAgo(86400) }),
    ]);

    const { backlog, state, reasons } = await status();

    expect(backlog.unreconciledCount).toBe(4);
    expect(backlog.byAge).toEqual({ under1h: 1, from1hTo24h: 1, from24hTo7d: 1, over7d: 1 });
    expect(backlog.oldestAgeSeconds).toBe(10 * 86400);
    expect(backlog.byReason).toEqual({ reference_not_found: 2, amount_mismatch: 1, unclassified: 1 });
    expect(state).toBe("degraded");
    expect(reasons).toEqual(["backlog_aged"]);
  });

  it("bounds and redacts the backlog sample", async () => {
    await insertCursors([freshCursor(PLATFORM), freshCursor(DONATION)]);
    const rows = Array.from({ length: 12 }, (_, i) => unreconciled(i + 1, secondsAgo((i + 1) * 60)));
    await insertUnreconciled(rows);

    const { backlog } = await status();

    expect(backlog.unreconciledCount).toBe(12);
    expect(backlog.sample).toHaveLength(BACKLOG_SAMPLE_LIMIT);
    // Oldest first.
    expect(backlog.sample.map((row) => row.ageSeconds)).toEqual([720, 660, 600, 540, 480]);
    expect(backlog.sample[0]).toEqual({
      txHash: `aaaaaa…${hash(12).slice(-4)}`,
      reasonCode: "reference_not_found",
      referenceKind: "canonical",
      attempts: 2,
      firstSeenAt: secondsAgo(720).toISOString(),
      lastSeenAt: secondsAgo(720).toISOString(),
      ageSeconds: 720,
    });

    const serialized = JSON.stringify(backlog);
    for (const row of rows) {
      expect(serialized).not.toContain(row.stellarTxHash);
    }
    for (const leaked of ["GSENDER", PLATFORM, "SECRETREFERENCE", "12.5000000", "No checkout was issued"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("reports recent arrival, resolution and worker confirmation rates", async () => {
    await insertCursors([freshCursor(PLATFORM), freshCursor(DONATION)]);
    await insertUnreconciled([
      unreconciled(1, secondsAgo(10 * 60)),
      unreconciled(2, secondsAgo(20 * 60), { resolvedAt: secondsAgo(5 * 60) }),
      unreconciled(3, secondsAgo(5 * 3600), { resolvedAt: secondsAgo(4 * 3600) }),
      unreconciled(4, secondsAgo(3 * 86400)),
    ]);
    await Transaction.collection.insertMany([
      { type: "purchase", status: "confirmed", reconciledAt: secondsAgo(30 * 60) },
      { type: "purchase", status: "confirmed", reconciledAt: secondsAgo(6 * 3600) },
      { type: "purchase", status: "confirmed", reconciledAt: secondsAgo(3 * 86400) },
      // Confirmed by the submit flow, not the worker.
      { type: "purchase", status: "confirmed", confirmedAt: secondsAgo(60) },
    ]);

    const { throughput } = await status();

    expect(throughput.lastHour).toEqual({
      windowSeconds: 3600,
      unreconciledArrived: 2,
      unreconciledResolved: 1,
      confirmedByWorker: 1,
      netBacklogChange: 1,
    });
    expect(throughput.last24h).toEqual({
      windowSeconds: 86400,
      unreconciledArrived: 3,
      unreconciledResolved: 2,
      confirmedByWorker: 2,
      netBacklogChange: 1,
    });
  });

  it("flags a backlog growing faster than the threshold", async () => {
    await insertCursors([freshCursor(PLATFORM), freshCursor(DONATION)]);
    await insertUnreconciled(Array.from({ length: 10 }, (_, i) => unreconciled(i + 1, secondsAgo(60))));

    const { state, reasons } = await status();

    expect(state).toBe("degraded");
    expect(reasons).toEqual(["backlog_growing"]);
  });

  it("serves backlog and throughput queries from indexes", async () => {
    await insertUnreconciled(Array.from({ length: 20 }, (_, i) => unreconciled(i + 1, secondsAgo(i * 600))));

    const planStage = async (query) => {
      const plan = await query.explain("queryPlanner");
      return JSON.stringify(plan.queryPlanner?.winningPlan ?? plan);
    };

    expect(
      await planStage(UnreconciledPayment.find({ resolvedAt: null, createdAt: { $type: "date" } }).sort({ createdAt: 1 }).limit(5))
    ).toContain("IXSCAN");
    expect(await planStage(UnreconciledPayment.find({ createdAt: { $gte: secondsAgo(3600) } }))).toContain("IXSCAN");
    expect(await planStage(Transaction.find({ reconciledAt: { $gte: secondsAgo(3600) } }))).toContain("IXSCAN");
  });

  it("publishes the computed state to the Prometheus gauges", async () => {
    await insertCursors([
      freshCursor(PLATFORM),
      freshCursor(DONATION, { lastSuccessAt: secondsAgo(600), consecutiveFailures: 4 }),
    ]);
    await insertUnreconciled([unreconciled(1, secondsAgo(2 * 86400))]);

    await status();

    expect(await gaugeValue("payment_reconciliation_health_state", { state: "degraded" })).toBe(1);
    expect(await gaugeValue("payment_reconciliation_health_state", { state: "healthy" })).toBe(0);
    expect(await gaugeValue("payment_ingestion_cursor_state", { role: "donation", state: "stale" })).toBe(1);
    expect(await gaugeValue("payment_ingestion_cursor_state", { role: "platform", state: "fresh" })).toBe(1);
    expect(await gaugeValue("payment_ingestion_cursor_lag_seconds", { role: "donation" })).toBe(600);
    expect(await gaugeValue("payment_ingestion_consecutive_failures", { role: "donation" })).toBe(4);
    expect(await gaugeValue("payment_reconciliation_backlog", { age_bucket: "from24hTo7d" })).toBe(1);
    expect(await gaugeValue("payment_reconciliation_backlog_oldest_age_seconds")).toBe(2 * 86400);

    // Metric labels carry roles, never wallet addresses.
    const exposition = await registry.metrics();
    expect(exposition).not.toContain(PLATFORM);
    expect(exposition).not.toContain(DONATION);
  });

  it("refreshes the gauges on scrape once a provider is registered", async () => {
    const original = { ...process.env };
    process.env.PLATFORM_WALLET_PUBLIC_KEY = PLATFORM;
    delete process.env.DONATION_WALLET_PUBLIC_KEY;
    try {
      registerReconciliationHealthMetrics();
      await refreshReconciliationHealth();
      // No cursor exists for the platform account yet.
      expect(await gaugeValue("payment_reconciliation_health_state", { state: "stalled" })).toBe(1);
      expect(await gaugeValue("payment_ingestion_cursor_state", { role: "platform", state: "missing" })).toBe(1);
    } finally {
      setReconciliationHealthProvider(null);
      process.env = original;
    }
  });

  it("marks the health state unknown when the provider fails", async () => {
    setReconciliationHealthProvider(async () => {
      throw new Error("db down");
    });
    try {
      await refreshReconciliationHealth();
      expect(await gaugeValue("payment_reconciliation_health_state", { state: "unknown" })).toBe(1);
      expect(await gaugeValue("payment_reconciliation_health_state", { state: "healthy" })).toBe(0);
    } finally {
      setReconciliationHealthProvider(null);
    }
  });

  describe("GET /reconciliation/status controller", () => {
    const buildApp = () => {
      const app = express();
      app.get("/reconciliation/status", reconciliationStatus);
      return app;
    };

    it("wraps the DTO in the standard envelope and forbids caching", async () => {
      const original = { ...process.env };
      Object.assign(process.env, ENV);
      try {
        // The controller uses the real clock, not the pinned NOW.
        const justNow = new Date();
        const live = {
          lastPollAt: justNow,
          lastSuccessAt: justNow,
          leaseExpiresAt: new Date(justNow.getTime() + 60_000),
        };
        await insertCursors([freshCursor(PLATFORM, live), freshCursor(DONATION, live)]);

        const res = await request(buildApp()).get("/reconciliation/status");

        expect(res.status).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body.success).toBe(true);
        expect(res.body.reconciliation.version).toBe(RECONCILIATION_STATUS_VERSION);
        expect(res.body.reconciliation.state).toBe("healthy");
        // The pre-#696 raw cursor list is gone.
        expect(res.body.cursors).toBeUndefined();
        expect(res.body.reconciliation.cursors).toBeUndefined();
      } finally {
        process.env = original;
      }
    });

    it("returns 503 without internal details when the status cannot be computed", async () => {
      jest.spyOn(IngestionCursor, "find").mockImplementation(() => {
        throw new Error("connection to mongo-internal:27017 refused");
      });

      const res = await request(buildApp()).get("/reconciliation/status");

      expect(res.status).toBe(503);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("DATABASE_ERROR");
      expect(JSON.stringify(res.body)).not.toContain("mongo-internal");
    });
  });
});
