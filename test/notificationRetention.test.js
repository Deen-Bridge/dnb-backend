import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Notification from "../src/models/Notification.js";
import {
  DEFAULT_RETENTION_POLICY,
  purgeNotifications,
  resolveRetentionPolicy,
  retentionCutoffs,
  runNotificationRetention,
} from "../src/jobs/notificationRetentionJob.js";

const NOW = new Date("2026-11-23T00:00:00.000Z");
const daysAgo = (days) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

/**
 * Issue #646 — notification retention and cleanup policy.
 */
describe("Notification retention (#646)", () => {
  let mongoServer;
  const recipient = new mongoose.Types.ObjectId();
  const sender = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Notification.collection.deleteMany({});
  });

  // Written through the driver so `createdAt` is the timestamp under test
  // rather than "now".
  const seedRows = (rows) =>
    Notification.collection.insertMany(
      rows.map((row, index) => ({
        recipient,
        sender,
        type: row.type || "course_update",
        title: `Row ${index}`,
        message: "Body",
        isRead: row.isRead ?? false,
        isDeleted: row.isDeleted ?? false,
        data: {},
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      }))
    );

  it("documents the default retention windows", () => {
    expect(DEFAULT_RETENTION_POLICY).toMatchObject({ deleted: 30, read: 90, unread: 365 });
    expect(DEFAULT_RETENTION_POLICY.protectedTypes).toContain("system");
  });

  it("computes cutoffs from the policy and honours environment overrides", () => {
    const cutoffs = retentionCutoffs(NOW, { deleted: 1, read: 2, unread: 3 });
    expect(cutoffs.deleted).toEqual(daysAgo(1));
    expect(cutoffs.read).toEqual(daysAgo(2));
    expect(cutoffs.unread).toEqual(daysAgo(3));

    const policy = resolveRetentionPolicy({
      NOTIFICATION_RETENTION_READ_DAYS: "10",
      NOTIFICATION_RETENTION_DELETED_DAYS: "not-a-number",
    });
    expect(policy.read).toBe(10);
    expect(policy.deleted).toBe(DEFAULT_RETENTION_POLICY.deleted);
    expect(policy.unread).toBe(DEFAULT_RETENTION_POLICY.unread);
  });

  it("removes rows past each boundary and keeps the ones inside it", async () => {
    await seedRows([
      { isRead: true, createdAt: daysAgo(120) }, // past read retention
      { isRead: true, createdAt: daysAgo(89) }, // inside read retention
      { isDeleted: true, createdAt: daysAgo(31) }, // past deleted retention
      { isDeleted: true, createdAt: daysAgo(29) }, // inside deleted retention
      { isRead: false, createdAt: daysAgo(400) }, // past unread retention
      { isRead: false, createdAt: daysAgo(364) }, // inside unread retention
    ]);

    const result = await purgeNotifications({ now: NOW });

    expect(result.counts).toEqual({ deleted: 1, read: 1, unread: 1 });
    expect(result.total).toBe(3);

    const remaining = await Notification.find({}).select("isRead isDeleted createdAt").lean();
    expect(remaining).toHaveLength(3);
    const ages = remaining.map((row) => Math.round((NOW - row.createdAt) / 86400000)).sort((a, b) => a - b);
    expect(ages).toEqual([29, 89, 364]);
  });

  it("never purges protected notification types", async () => {
    await seedRows([
      { type: "system", isRead: true, createdAt: daysAgo(4000) },
      { type: "pledge_due", isRead: true, createdAt: daysAgo(4000) },
    ]);

    const result = await purgeNotifications({ now: NOW });

    expect(result.total).toBe(0);
    expect(await Notification.countDocuments({})).toBe(2);
  });

  it("counts without deleting in dry-run mode", async () => {
    await seedRows([{ isRead: true, createdAt: daysAgo(200) }]);

    const result = await purgeNotifications({ now: NOW, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.counts.read).toBe(1);
    expect(await Notification.countDocuments({})).toBe(1);
  });

  it("is safe to run twice — the second pass deletes nothing", async () => {
    await seedRows([{ isRead: true, createdAt: daysAgo(200) }]);

    expect((await purgeNotifications({ now: NOW })).total).toBe(1);
    expect((await purgeNotifications({ now: NOW })).total).toBe(0);
  });

  it("logs and returns counts through the scheduled entry point", async () => {
    await seedRows([{ isDeleted: true, createdAt: daysAgo(60) }]);

    const result = await runNotificationRetention({ now: NOW });

    expect(result.total).toBe(1);
    expect(result.counts.deleted).toBe(1);
    expect(await Notification.countDocuments({})).toBe(0);
  });
});
