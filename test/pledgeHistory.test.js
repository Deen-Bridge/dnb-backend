import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import * as StellarSdk from "@stellar/stellar-sdk";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import app from "../app.js";
import Pledge from "../src/models/Pledge.js";
import PledgeCycle from "../src/models/PledgeCycle.js";
import Transaction from "../src/models/Transaction.js";
import User from "../src/models/User.js";
import { registry } from "../src/config/metrics.js";
import {
  archiveStalePledgeCycles,
  DEFAULT_PLEDGE_CYCLE_RETENTION_DAYS,
  getPledgeCycleRetentionDays,
} from "../src/services/pledgeService.js";
import {
  DEFAULT_PLEDGE_PAGE_SIZE,
  MAX_PLEDGE_PAGE_SIZE,
} from "../src/services/pledgeReadService.js";
import { decodeCursor, encodeCursor } from "../src/utils/keysetCursor.js";

const BASE = "/api/stellar/pledges";
const DAY_MS = 24 * 60 * 60 * 1000;
const MISSING_ID = "64b7f0c2a1b2c3d4e5f60718";

const PLEDGE_DTO_KEYS = [
  "_id",
  "amount",
  "anchorDate",
  "anchorDay",
  "cadence",
  "consecutivePaid",
  "createdAt",
  "lastPaidAt",
  "longestStreak",
  "nextDueAt",
  "publicKey",
  "status",
  "totalPaidStroops",
  "updatedAt",
];
const CYCLE_DTO_KEYS = ["_id", "archived", "dueAt", "pledge", "status", "transaction", "windowEndsAt"];
const PAYMENT_DTO_KEYS = ["_id", "confirmedAt", "status", "stellarTxHash"];

// Values that live on the Transaction document but must never reach a client.
const SECRET_XDR = "AAAAAgAAAABsecretunsignedxdrpayload";
const SECRET_MEMO = "DNB-PLEDGE";
const SECRET_REFERENCE = "dnbref_secret_reference";

const tokenFor = (user) =>
  jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const wallet = () => StellarSdk.Keypair.random().publicKey();

/** Walk every page of a listing endpoint, returning all items and page sizes. */
const collectPages = async (path, token, key, query = {}) => {
  const items = [];
  const sizes = [];
  let cursor;
  for (let guard = 0; guard < 100; guard += 1) {
    const res = await request(app)
      .get(path)
      .query(cursor ? { ...query, cursor } : query)
      .set(auth(token));
    expect(res.status).toBe(200);
    items.push(...res.body[key]);
    sizes.push(res.body[key].length);
    if (!res.body.pageInfo.hasMore) {
      expect(res.body.pageInfo.nextCursor).toBeNull();
      return { items, sizes };
    }
    cursor = res.body.pageInfo.nextCursor;
  }
  throw new Error("pagination did not terminate");
};

const metricCount = async (name, labels) => {
  const metric = await registry.getSingleMetric(name).get();
  const sample = metric.values.find(
    (value) =>
      value.metricName === `${name}_count` &&
      Object.entries(labels).every(([label, expected]) => value.labels[label] === expected)
  );
  return sample ? sample.value : 0;
};

describe("Pledge history reads (#698)", () => {
  let replSet;
  let donor;
  let other;
  let donorToken;
  let otherToken;

  const seedPledges = (user, count, { base = Date.UTC(2024, 0, 1), overrides = () => ({}) } = {}) =>
    Pledge.collection.insertMany(
      Array.from({ length: count }, (_, index) => {
        const createdAt = new Date(base + index * 60_000);
        return {
          user: user._id,
          publicKey: wallet(),
          amount: "5",
          cadence: "daily",
          status: "active",
          nextDueAt: new Date(base + DAY_MS),
          consecutivePaid: 0,
          longestStreak: 0,
          totalPaidStroops: "0",
          schedulerLockUntil: new Date(base),
          createdAt,
          updatedAt: createdAt,
          __v: 0,
          ...overrides(index),
        };
      })
    );

  const seedCycles = async (pledgeId, count, { start = Date.UTC(2024, 0, 1), overrides = () => ({}) } = {}) => {
    const docs = Array.from({ length: count }, (_, index) => {
      const dueAt = new Date(start + index * DAY_MS);
      return {
        pledge: pledgeId,
        dueAt,
        windowEndsAt: new Date(dueAt.getTime() + 3 * DAY_MS),
        status: "paid",
        transaction: null,
        archivedAt: null,
        createdAt: dueAt,
        updatedAt: dueAt,
        ...overrides(index),
      };
    });
    await PledgeCycle.collection.insertMany(docs);
    return docs;
  };

  const seedDonation = (buyer, overrides = {}) =>
    Transaction.collection
      .insertOne({
        type: "donation",
        buyer: buyer._id,
        buyerWallet: wallet(),
        creatorWallet: wallet(),
        amount: "5",
        currency: "USDC",
        network: "testnet",
        status: "confirmed",
        stellarTxHash: `hash_${new mongoose.Types.ObjectId()}`,
        confirmedAt: new Date(Date.UTC(2024, 5, 1)),
        unsignedXdr: SECRET_XDR,
        memo: SECRET_MEMO,
        paymentReference: SECRET_REFERENCE,
        platformFee: { feePercent: 2, platformWallet: wallet(), platformAmount: "0.1", creatorAmount: "4.9" },
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      })
      .then((result) => result.insertedId);

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    await mongoose.connect(replSet.getUri());
    await Promise.all([Pledge.syncIndexes(), PledgeCycle.syncIndexes()]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Pledge.deleteMany({}),
      PledgeCycle.deleteMany({}),
      Transaction.deleteMany({}),
      User.deleteMany({}),
    ]);
    [donor, other] = await User.create([
      { name: "Donor", email: "donor@example.com", password: "x".repeat(12), role: "student", isVerified: true },
      { name: "Other", email: "other@example.com", password: "x".repeat(12), role: "student", isVerified: true },
    ]);
    [donorToken, otherToken] = [donor, other].map(tokenFor);
  });

  describe("GET /pledges", () => {
    it("returns an empty first page for a donor with no history", async () => {
      const res = await request(app).get(BASE).set(auth(donorToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        pledges: [],
        pageInfo: { limit: DEFAULT_PLEDGE_PAGE_SIZE, hasMore: false, nextCursor: null },
      });
    });

    it("pages a long-lived donor's history deterministically without gaps or repeats", async () => {
      // 12 pledges share one createdAt so the _id tiebreaker has to hold.
      const tiedAt = new Date(Date.UTC(2024, 6, 1));
      await seedPledges(donor, 113);
      await seedPledges(donor, 12, { overrides: () => ({ createdAt: tiedAt, updatedAt: tiedAt }) });
      await seedPledges(other, 7);

      const { items, sizes } = await collectPages(BASE, donorToken, "pledges", { limit: MAX_PLEDGE_PAGE_SIZE });

      expect(sizes).toEqual([50, 50, 25]);
      expect(new Set(items.map((pledge) => pledge._id)).size).toBe(125);

      const owned = await Pledge.find({ user: donor._id }).sort({ createdAt: -1, _id: -1 }).select("_id").lean();
      expect(items.map((pledge) => pledge._id)).toEqual(owned.map((pledge) => String(pledge._id)));
    });

    it("stops exactly on a page boundary when the history fills the last page", async () => {
      await seedPledges(donor, 40);
      const first = await request(app).get(BASE).query({ limit: 20 }).set(auth(donorToken));
      expect(first.body.pageInfo).toMatchObject({ limit: 20, hasMore: true });

      const second = await request(app)
        .get(BASE)
        .query({ limit: 20, cursor: first.body.pageInfo.nextCursor })
        .set(auth(donorToken));
      expect(second.body.pledges).toHaveLength(20);
      expect(second.body.pageInfo).toEqual({ limit: 20, hasMore: false, nextCursor: null });
    });

    it("filters by status while paging", async () => {
      await seedPledges(donor, 30, { overrides: (index) => ({ status: index % 3 === 0 ? "paused" : "active" }) });
      const { items } = await collectPages(BASE, donorToken, "pledges", { status: "paused", limit: 4 });
      expect(items).toHaveLength(10);
      expect(items.every((pledge) => pledge.status === "paused")).toBe(true);
    });

    it("serializes only the public pledge DTO", async () => {
      await seedPledges(donor, 1);
      const res = await request(app).get(BASE).set(auth(donorToken));
      const [pledge] = res.body.pledges;
      expect(Object.keys(pledge).sort()).toEqual(PLEDGE_DTO_KEYS);
      expect(res.text).not.toContain("schedulerLockUntil");
      expect(res.text).not.toContain(String(donor._id));
    });

    it.each([
      [{ limit: "0" }, "limit"],
      [{ limit: String(MAX_PLEDGE_PAGE_SIZE + 1) }, "limit"],
      [{ limit: "ten" }, "limit"],
      [{ status: "deleted" }, "status"],
      [{ cursor: "not a cursor!" }, "cursor"],
      [{ cursor: "x".repeat(400) }, "cursor"],
      [{ cursor: encodeCursor("pledge-cycle", new Date()) }, "cursor"],
      [{ cursor: encodeCursor("pledge", new Date()) }, "cursor"],
    ])("rejects invalid query %o", async (query, field) => {
      const res = await request(app).get(BASE).query(query).set(auth(donorToken));
      expect(res.status).toBe(400);
      expect(res.body.errors.map((error) => error.field)).toContain(field);
    });

    it("rejects repeated query parameters", async () => {
      const res = await request(app).get(`${BASE}?limit=5&limit=10`).set(auth(donorToken));
      expect(res.status).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });

    it("records duration, response size and item telemetry", async () => {
      await seedPledges(donor, 3);
      const before = await metricCount("pledge_read_response_bytes", { operation: "list" });
      const itemsBefore = await metricCount("pledge_read_items", { operation: "list" });
      const durationBefore = await metricCount("pledge_read_duration_seconds", { operation: "list", outcome: "success" });

      await request(app).get(BASE).set(auth(donorToken)).expect(200);

      expect(await metricCount("pledge_read_response_bytes", { operation: "list" })).toBe(before + 1);
      expect(await metricCount("pledge_read_items", { operation: "list" })).toBe(itemsBefore + 1);
      expect(
        await metricCount("pledge_read_duration_seconds", { operation: "list", outcome: "success" })
      ).toBe(durationBefore + 1);
    });

    it("serves pages from the user/createdAt index instead of scanning history", async () => {
      await seedPledges(donor, 200);
      const plan = await Pledge.find({ user: donor._id })
        .sort({ createdAt: -1, _id: -1 })
        .limit(DEFAULT_PLEDGE_PAGE_SIZE + 1)
        .explain("executionStats");
      expect(plan.executionStats.totalDocsExamined).toBeLessThanOrEqual(DEFAULT_PLEDGE_PAGE_SIZE + 1);
    });
  });

  describe("GET /pledges/stats", () => {
    it("returns zeroed totals for an empty history", async () => {
      const res = await request(app).get(`${BASE}/stats`).set(auth(donorToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        totalPaidStroops: "0",
        longestStreak: 0,
        active: 0,
        paused: 0,
        cancelled: 0,
        total: 0,
      });
    });

    it("aggregates exact totals without returning the pledge payload", async () => {
      const statuses = ["active", "active", "paused", "cancelled"];
      // The first value exceeds Number.MAX_SAFE_INTEGER to prove the sum is exact.
      const paid = ["9007199254740993", "10", "250000000", "0"];
      await seedPledges(donor, 4, {
        overrides: (index) => ({
          status: statuses[index],
          totalPaidStroops: paid[index],
          longestStreak: [3, 9, 4, 1][index],
        }),
      });
      // A legacy row without the counter must count as zero, not break the sum.
      await Pledge.collection.updateOne({ status: "cancelled" }, { $unset: { totalPaidStroops: "" } });
      await seedPledges(other, 2, { overrides: () => ({ totalPaidStroops: "999", longestStreak: 50 }) });

      const res = await request(app).get(`${BASE}/stats`).set(auth(donorToken));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        totalPaidStroops: (9007199254740993n + 10n + 250000000n).toString(),
        longestStreak: 9,
        active: 2,
        paused: 1,
        cancelled: 1,
        total: 4,
      });
      expect(res.body).not.toHaveProperty("pledges");
    });

    it("keeps totals stable when cycle history is archived", async () => {
      const { insertedIds } = await seedPledges(donor, 1, {
        overrides: () => ({ totalPaidStroops: "50000000", longestStreak: 5 }),
      });
      await seedCycles(insertedIds[0], 5);

      const before = await request(app).get(`${BASE}/stats`).set(auth(donorToken));
      const archived = await archiveStalePledgeCycles({ now: new Date(Date.UTC(2027, 0, 1)), retentionDays: 30 });
      const after = await request(app).get(`${BASE}/stats`).set(auth(donorToken));

      expect(archived).toBe(5);
      expect(after.body).toEqual(before.body);
    });
  });

  describe("GET /pledges/:id/cycles", () => {
    let pledgeId;

    beforeEach(async () => {
      const { insertedIds } = await seedPledges(donor, 1);
      pledgeId = String(insertedIds[0]);
    });

    it("returns an empty page for a pledge with no cycles", async () => {
      const res = await request(app).get(`${BASE}/${pledgeId}/cycles`).set(auth(donorToken));
      expect(res.status).toBe(200);
      expect(res.body.cycles).toEqual([]);
      expect(res.body.pageInfo).toEqual({ limit: DEFAULT_PLEDGE_PAGE_SIZE, hasMore: false, nextCursor: null });
    });

    it("pages a long cycle history newest-first", async () => {
      await seedCycles(new mongoose.Types.ObjectId(pledgeId), 130);
      const { items, sizes } = await collectPages(`${BASE}/${pledgeId}/cycles`, donorToken, "cycles", {
        limit: MAX_PLEDGE_PAGE_SIZE,
      });

      expect(sizes).toEqual([50, 50, 30]);
      expect(new Set(items.map((cycle) => cycle._id)).size).toBe(130);
      const dueTimes = items.map((cycle) => new Date(cycle.dueAt).getTime());
      expect(dueTimes).toEqual([...dueTimes].sort((a, b) => b - a));
    });

    it("exposes payment status only, never the transaction document", async () => {
      const paidTx = await seedDonation(donor);
      const foreignTx = await seedDonation(other, { paymentReference: "dnbref_foreign_reference" });
      await seedCycles(new mongoose.Types.ObjectId(pledgeId), 3, {
        overrides: (index) => ({ transaction: [paidTx, foreignTx, null][index] }),
      });

      const res = await request(app).get(`${BASE}/${pledgeId}/cycles`).set(auth(donorToken));

      expect(res.status).toBe(200);
      const byTransaction = res.body.cycles.map((cycle) => cycle.transaction);
      // Newest first: [null, foreign (not the donor's, so hidden), paid].
      expect(byTransaction[0]).toBeNull();
      expect(byTransaction[1]).toBeNull();
      expect(Object.keys(byTransaction[2]).sort()).toEqual(PAYMENT_DTO_KEYS);
      expect(byTransaction[2]).toMatchObject({ _id: String(paidTx), status: "confirmed" });
      res.body.cycles.forEach((cycle) => expect(Object.keys(cycle).sort()).toEqual(CYCLE_DTO_KEYS));

      for (const secret of [SECRET_XDR, SECRET_MEMO, SECRET_REFERENCE, "buyerWallet", "creatorWallet", "platformFee"]) {
        expect(res.text).not.toContain(secret);
      }
    });

    it("hides archived cycles unless includeArchived=true", async () => {
      await seedCycles(new mongoose.Types.ObjectId(pledgeId), 6, {
        overrides: (index) => ({ archivedAt: index < 4 ? new Date() : null }),
      });

      const visible = await request(app).get(`${BASE}/${pledgeId}/cycles`).set(auth(donorToken));
      expect(visible.body.cycles).toHaveLength(2);
      expect(visible.body.cycles.every((cycle) => cycle.archived === false)).toBe(true);

      const all = await request(app)
        .get(`${BASE}/${pledgeId}/cycles`)
        .query({ includeArchived: "true" })
        .set(auth(donorToken));
      expect(all.body.cycles).toHaveLength(6);
      expect(all.body.cycles.filter((cycle) => cycle.archived)).toHaveLength(4);
    });

    it("returns 404 for another donor's pledge and for unknown pledges", async () => {
      const foreign = await request(app).get(`${BASE}/${pledgeId}/cycles`).set(auth(otherToken));
      expect(foreign.status).toBe(404);
      const missing = await request(app).get(`${BASE}/${MISSING_ID}/cycles`).set(auth(donorToken));
      expect(missing.status).toBe(404);
    });

    it.each([
      [{}, "not-an-id", "id"],
      [{ includeArchived: "yes" }, null, "includeArchived"],
      [{ limit: "51" }, null, "limit"],
      [{ cursor: encodeCursor("pledge", new Date(), MISSING_ID) }, null, "cursor"],
    ])("rejects invalid input %o", async (query, id, field) => {
      const res = await request(app)
        .get(`${BASE}/${id ?? pledgeId}/cycles`)
        .query(query)
        .set(auth(donorToken));
      expect(res.status).toBe(400);
      expect(res.body.errors.map((error) => error.field)).toContain(field);
    });

    it("serves pages from the pledge/dueAt index instead of scanning history", async () => {
      await seedCycles(new mongoose.Types.ObjectId(pledgeId), 300);
      const plan = await PledgeCycle.find({ pledge: pledgeId, archivedAt: null })
        .sort({ dueAt: -1 })
        .limit(DEFAULT_PLEDGE_PAGE_SIZE + 1)
        .explain("executionStats");
      expect(plan.executionStats.totalDocsExamined).toBeLessThanOrEqual(DEFAULT_PLEDGE_PAGE_SIZE + 1);
    });
  });

  describe("pledge write responses", () => {
    it("returns the pledge DTO from create and status update", async () => {
      const created = await request(app)
        .post(BASE)
        .set(auth(donorToken))
        .send({ publicKey: wallet(), amount: "5", cadence: "weekly", anchorDay: 2 });
      expect(created.status).toBe(201);
      expect(Object.keys(created.body.pledge).sort()).toEqual(PLEDGE_DTO_KEYS);

      const updated = await request(app)
        .patch(`${BASE}/${created.body.pledge._id}/status`)
        .set(auth(donorToken))
        .send({ status: "paused" });
      expect(updated.status).toBe(200);
      expect(Object.keys(updated.body.pledge).sort()).toEqual(PLEDGE_DTO_KEYS);
      expect(updated.body.pledge.status).toBe("paused");
    });
  });

  describe("cycle retention", () => {
    const NOW = new Date(Date.UTC(2026, 0, 1));

    it("archives only settled cycles older than the retention window, in bounded batches", async () => {
      const pledge = new mongoose.Types.ObjectId();
      const old = NOW.getTime() - 400 * DAY_MS;
      await PledgeCycle.collection.insertMany(
        ["paid", "skipped", "lapsed", "due", "notified"].map((status, index) => ({
          pledge,
          dueAt: new Date(old + index * DAY_MS),
          windowEndsAt: new Date(old + (index + 3) * DAY_MS),
          status,
          transaction: null,
        }))
      );
      await PledgeCycle.collection.insertOne({
        pledge,
        dueAt: new Date(NOW.getTime() - 10 * DAY_MS),
        windowEndsAt: new Date(NOW.getTime() - 7 * DAY_MS),
        status: "paid",
        transaction: null,
      });

      expect(await archiveStalePledgeCycles({ now: NOW, retentionDays: 365, batchSize: 2 })).toBe(2);
      expect(await archiveStalePledgeCycles({ now: NOW, retentionDays: 365, batchSize: 2 })).toBe(1);
      expect(await archiveStalePledgeCycles({ now: NOW, retentionDays: 365, batchSize: 2 })).toBe(0);

      const archivedStatuses = (await PledgeCycle.find({ archivedAt: { $ne: null } }).lean()).map((c) => c.status);
      expect(archivedStatuses.sort()).toEqual(["lapsed", "paid", "skipped"]);
      expect(await PledgeCycle.countDocuments()).toBe(6);
    });

    it("parses PLEDGE_CYCLE_RETENTION_DAYS defensively", () => {
      expect(getPledgeCycleRetentionDays({})).toBe(DEFAULT_PLEDGE_CYCLE_RETENTION_DAYS);
      expect(getPledgeCycleRetentionDays({ PLEDGE_CYCLE_RETENTION_DAYS: "90" })).toBe(90);
      for (const invalid of ["0", "-5", "1.5", "forever"]) {
        expect(getPledgeCycleRetentionDays({ PLEDGE_CYCLE_RETENTION_DAYS: invalid })).toBe(
          DEFAULT_PLEDGE_CYCLE_RETENTION_DAYS
        );
      }
    });
  });

  describe("model indexes", () => {
    const has = (model, keys) =>
      model.schema.indexes().some(([spec]) => JSON.stringify(spec) === JSON.stringify(keys));

    it("covers user/status/date and pledge/due-date access patterns", () => {
      expect(has(Pledge, { user: 1, createdAt: -1, _id: -1 })).toBe(true);
      expect(has(Pledge, { user: 1, status: 1, createdAt: -1, _id: -1 })).toBe(true);
      expect(has(PledgeCycle, { pledge: 1, archivedAt: 1, dueAt: -1 })).toBe(true);
      expect(has(PledgeCycle, { status: 1, archivedAt: 1, dueAt: 1 })).toBe(true);
    });
  });
});

describe("keyset cursor", () => {
  it("round-trips and rejects tampering or cross-endpoint reuse", () => {
    const at = new Date(Date.UTC(2025, 2, 3));
    const id = "64b7f0c2a1b2c3d4e5f60718";
    const cursor = encodeCursor("pledge", at, id);

    expect(decodeCursor(cursor, "pledge", { requireId: true })).toEqual({ at, id });
    expect(decodeCursor(cursor, "pledge-cycle")).toBeNull();
    expect(decodeCursor(encodeCursor("pledge", at), "pledge", { requireId: true })).toBeNull();

    const forged = Buffer.from(JSON.stringify({ k: "pledge", t: at.toISOString(), id: { $gt: "" } })).toString(
      "base64url"
    );
    expect(decodeCursor(forged, "pledge")).toBeNull();
    expect(decodeCursor(Buffer.from("{bad json").toString("base64url"), "pledge")).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ k: "pledge", t: "nope" })).toString("base64url"), "pledge")).toBeNull();
    expect(decodeCursor(["array"], "pledge")).toBeNull();
  });
});
