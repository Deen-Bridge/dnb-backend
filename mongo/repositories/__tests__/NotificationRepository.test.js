import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Notification from "../../../src/models/Notification.js";
import {
  NotificationRepository,
  NOTIFICATION_TYPES,
  NOTIFICATION_PRIORITIES,
} from "../NotificationRepository.js";

describe("NotificationRepository", () => {
  let mongoServer;
  let repo;

  const userId = new mongoose.Types.ObjectId();
  const senderId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    repo = new NotificationRepository(Notification);
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Notification.deleteMany({});
  });

  /* -------------------------------------------------------------------- */
  /* Helpers                                                              */
  /* -------------------------------------------------------------------- */

  const createNotification = (overrides = {}) =>
    Notification.create({
      recipient: userId,
      sender: senderId,
      type: "follow",
      title: "New follower",
      message: "Someone followed you",
      priority: "medium",
      ...overrides,
    });

  const createBulkNotifications = (count, overrides = {}) =>
    Notification.insertMany(
      Array.from({ length: count }, (_, i) => ({
        recipient: userId,
        sender: senderId,
        type: NOTIFICATION_TYPES[i % NOTIFICATION_TYPES.length],
        title: `Notification ${i + 1}`,
        message: `Message ${i + 1}`,
        priority: NOTIFICATION_PRIORITIES[i % NOTIFICATION_PRIORITIES.length],
        isRead: i % 3 === 0,
        ...overrides,
      }))
    );

  /* -------------------------------------------------------------------- */
  /* Construction                                                         */
  /* -------------------------------------------------------------------- */

  describe("constructor", () => {
    it("creates an instance extending BaseRepository", () => {
      expect(repo).toBeInstanceOf(NotificationRepository);
      expect(repo.model).toBe(Notification);
    });

    it("accepts a custom model for testing", () => {
      const custom = new NotificationRepository(Notification);
      expect(custom.model).toBe(Notification);
    });
  });

  /* -------------------------------------------------------------------- */
  /* findByUser                                                           */
  /* -------------------------------------------------------------------- */

  describe("findByUser", () => {
    it("returns only notifications for the specified user", async () => {
      const otherUser = new mongoose.Types.ObjectId();

      await createBulkNotifications(3);
      await createBulkNotifications(2, { recipient: otherUser });

      const results = await repo.findByUser(userId);
      expect(results).toHaveLength(3);
      for (const doc of results) {
        expect(doc.recipient.toString()).toBe(userId.toString());
      }
    });

    it("excludes soft-deleted notifications", async () => {
      await createNotification({ isDeleted: true });
      await createNotification({ isDeleted: false });

      const results = await repo.findByUser(userId);
      expect(results).toHaveLength(1);
    });

    it("sorts newest first by default", async () => {
      const old = await createNotification({ title: "Old" });
      await new Promise((r) => setTimeout(r, 10));
      const newer = await createNotification({ title: "Newer" });

      const results = await repo.findByUser(userId);
      expect(results[0].title).toBe("Newer");
      expect(results[1].title).toBe("Old");
    });

    it("supports additional filter criteria", async () => {
      await createNotification({ type: "follow" });
      await createNotification({ type: "system" });

      const results = await repo.findByUser(userId, {
        filter: { type: "follow" },
      });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("follow");
    });

    it("supports limit option", async () => {
      await createBulkNotifications(5);

      const results = await repo.findByUser(userId, { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("supports paginated mode", async () => {
      await createBulkNotifications(5);

      const page1 = await repo.findByUser(userId, {
        paginate: true,
        limit: 2,
        page: 1,
      });
      expect(page1.data).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.totalPages).toBe(3);
      expect(page1.hasNextPage).toBe(true);
      expect(page1.hasPrevPage).toBe(false);

      const page2 = await repo.findByUser(userId, {
        paginate: true,
        limit: 2,
        page: 2,
      });
      expect(page2.data).toHaveLength(2);
      expect(page2.hasPrevPage).toBe(true);
    });

    it("throws when userId is missing", async () => {
      await expect(repo.findByUser(null)).rejects.toThrow("userId");
      await expect(repo.findByUser(undefined)).rejects.toThrow("userId");
      await expect(repo.findByUser("")).rejects.toThrow("userId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* findUnread                                                           */
  /* -------------------------------------------------------------------- */

  describe("findUnread", () => {
    it("returns only unread notifications", async () => {
      await createNotification({ isRead: false });
      await createNotification({ isRead: false });
      await createNotification({ isRead: true });

      const results = await repo.findUnread(userId);
      expect(results).toHaveLength(2);
      for (const doc of results) {
        expect(doc.isRead).toBe(false);
      }
    });

    it("excludes soft-deleted notifications", async () => {
      await createNotification({ isRead: false, isDeleted: true });
      await createNotification({ isRead: false, isDeleted: false });

      const results = await repo.findUnread(userId);
      expect(results).toHaveLength(1);
    });

    it("combines with additional filter criteria", async () => {
      await createNotification({ type: "follow", isRead: false });
      await createNotification({ type: "system", isRead: false });
      await createNotification({ type: "follow", isRead: true });

      const results = await repo.findUnread(userId, {
        filter: { type: "follow" },
      });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("follow");
    });

    it("supports paginated mode", async () => {
      await createBulkNotifications(5, { isRead: false });

      const page = await repo.findUnread(userId, { paginate: true, limit: 3 });
      expect(page.data).toHaveLength(3);
      expect(page.total).toBe(5);
    });

    it("throws when userId is missing", async () => {
      await expect(repo.findUnread(null)).rejects.toThrow("userId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* findByType                                                           */
  /* -------------------------------------------------------------------- */

  describe("findByType", () => {
    it("returns only notifications of the specified type", async () => {
      await createNotification({ type: "follow" });
      await createNotification({ type: "follow" });
      await createNotification({ type: "system" });

      const results = await repo.findByType("follow");
      expect(results).toHaveLength(2);
      for (const doc of results) {
        expect(doc.type).toBe("follow");
      }
    });

    it("scopes to a specific user when userId is provided", async () => {
      const otherUser = new mongoose.Types.ObjectId();
      await createNotification({ type: "follow", recipient: userId });
      await createNotification({ type: "follow", recipient: otherUser });

      const results = await repo.findByType("follow", { userId });
      expect(results).toHaveLength(1);
      expect(results[0].recipient.toString()).toBe(userId.toString());
    });

    it("throws when type is missing", async () => {
      await expect(repo.findByType(null)).rejects.toThrow("type");
    });

    it("throws for invalid type", async () => {
      await expect(repo.findByType("invalid_type")).rejects.toThrow("invalid type");
    });
  });

  /* -------------------------------------------------------------------- */
  /* findByPriority                                                       */
  /* -------------------------------------------------------------------- */

  describe("findByPriority", () => {
    it("returns only notifications of the specified priority", async () => {
      await createNotification({ priority: "urgent" });
      await createNotification({ priority: "urgent" });
      await createNotification({ priority: "low" });

      const results = await repo.findByPriority("urgent");
      expect(results).toHaveLength(2);
      for (const doc of results) {
        expect(doc.priority).toBe("urgent");
      }
    });

    it("scopes to a specific user when userId is provided", async () => {
      const otherUser = new mongoose.Types.ObjectId();
      await createNotification({ priority: "urgent", recipient: userId });
      await createNotification({ priority: "urgent", recipient: otherUser });

      const results = await repo.findByPriority("urgent", { userId });
      expect(results).toHaveLength(1);
      expect(results[0].recipient.toString()).toBe(userId.toString());
    });

    it("throws when priority is missing", async () => {
      await expect(repo.findByPriority(null)).rejects.toThrow("priority");
    });

    it("throws for invalid priority", async () => {
      await expect(repo.findByPriority("extreme")).rejects.toThrow("invalid priority");
    });
  });

  /* -------------------------------------------------------------------- */
  /* markAsRead                                                           */
  /* -------------------------------------------------------------------- */

  describe("markAsRead", () => {
    it("marks a single notification as read", async () => {
      const notif = await createNotification({ isRead: false });
      const updated = await repo.markAsRead(notif._id);

      expect(updated.isRead).toBe(true);
    });

    it("does not affect other notifications", async () => {
      const notif1 = await createNotification({ isRead: false });
      const notif2 = await createNotification({ isRead: false });

      await repo.markAsRead(notif1._id);

      const check = await Notification.findById(notif2._id);
      expect(check.isRead).toBe(false);
    });

    it("returns null for non-existent notification", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const result = await repo.markAsRead(fakeId);
      expect(result).toBeNull();
    });

    it("throws when notificationId is missing", async () => {
      await expect(repo.markAsRead(null)).rejects.toThrow("notificationId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* markAllAsRead                                                        */
  /* -------------------------------------------------------------------- */

  describe("markAllAsRead", () => {
    it("marks all unread notifications for a user as read", async () => {
      await createNotification({ isRead: false });
      await createNotification({ isRead: false });
      await createNotification({ isRead: true });

      const result = await repo.markAllAsRead(userId);
      expect(result.acknowledged).toBe(true);
      expect(result.modifiedCount).toBe(2);

      const remaining = await Notification.find({ recipient: userId, isRead: false });
      expect(remaining).toHaveLength(0);
    });

    it("does not affect other users' notifications", async () => {
      const otherUser = new mongoose.Types.ObjectId();
      await createNotification({ isRead: false, recipient: userId });
      await createNotification({ isRead: false, recipient: otherUser });

      await repo.markAllAsRead(userId);

      const otherUserNotif = await Notification.findOne({ recipient: otherUser });
      expect(otherUserNotif.isRead).toBe(false);
    });

    it("does not affect soft-deleted notifications", async () => {
      await createNotification({ isRead: false, isDeleted: true });

      const result = await repo.markAllAsRead(userId);
      expect(result.modifiedCount).toBe(0);
    });

    it("returns zero modifiedCount when no unread exist", async () => {
      await createNotification({ isRead: true });

      const result = await repo.markAllAsRead(userId);
      expect(result.modifiedCount).toBe(0);
    });

    it("throws when userId is missing", async () => {
      await expect(repo.markAllAsRead(null)).rejects.toThrow("userId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* markManyAsRead                                                       */
  /* -------------------------------------------------------------------- */

  describe("markManyAsRead", () => {
    it("marks multiple specific notifications as read", async () => {
      const n1 = await createNotification({ isRead: false });
      const n2 = await createNotification({ isRead: false });
      await createNotification({ isRead: false });

      const result = await repo.markManyAsRead(userId, [n1._id, n2._id]);
      expect(result.modifiedCount).toBe(2);

      const check1 = await Notification.findById(n1._id);
      const check2 = await Notification.findById(n2._id);
      expect(check1.isRead).toBe(true);
      expect(check2.isRead).toBe(true);
    });

    it("does not update notifications belonging to another user", async () => {
      const otherUser = new mongoose.Types.ObjectId();
      const n1 = await createNotification({ isRead: false });
      const n2 = await createNotification({ isRead: false, recipient: otherUser });

      const result = await repo.markManyAsRead(userId, [n1._id, n2._id]);
      expect(result.modifiedCount).toBe(1);

      const check = await Notification.findById(n2._id);
      expect(check.isRead).toBe(false);
    });

    it("does not update already-read notifications", async () => {
      const n1 = await createNotification({ isRead: false });
      const n2 = await createNotification({ isRead: true });

      const result = await repo.markManyAsRead(userId, [n1._id, n2._id]);
      expect(result.modifiedCount).toBe(1);
    });

    it("throws when userId is missing", async () => {
      await expect(repo.markManyAsRead(null, [])).rejects.toThrow("userId");
    });

    it("throws when notificationIds is empty", async () => {
      await expect(repo.markManyAsRead(userId, [])).rejects.toThrow(
        "notificationIds"
      );
    });

    it("throws when notificationIds is not an array", async () => {
      await expect(repo.markManyAsRead(userId, "not-an-array")).rejects.toThrow(
        "notificationIds"
      );
    });
  });

  /* -------------------------------------------------------------------- */
  /* deleteOlderThan                                                      */
  /* -------------------------------------------------------------------- */

  describe("deleteOlderThan", () => {
    it("permanently deletes notifications older than the cutoff", async () => {
      const oldDate = new Date("2020-01-01");
      const newDate = new Date("2025-01-01");

      await Notification.create({
        recipient: userId,
        sender: senderId,
        type: "system",
        title: "Old",
        message: "Old message",
        createdAt: oldDate,
      });
      await Notification.create({
        recipient: userId,
        sender: senderId,
        type: "system",
        title: "New",
        message: "New message",
        createdAt: newDate,
      });

      const result = await repo.deleteOlderThan(new Date("2023-01-01"));
      expect(result.deletedCount).toBe(1);

      const remaining = await Notification.find({ recipient: userId });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].title).toBe("New");
    });

    it("supports extra filter criteria", async () => {
      const oldDate = new Date("2020-01-01");
      await Notification.create({
        recipient: userId,
        sender: senderId,
        type: "follow",
        title: "Old follow",
        message: "...",
        createdAt: oldDate,
      });
      await Notification.create({
        recipient: userId,
        sender: senderId,
        type: "system",
        title: "Old system",
        message: "...",
        createdAt: oldDate,
      });

      const result = await repo.deleteOlderThan(new Date("2023-01-01"), {
        filter: { type: "follow" },
      });
      expect(result.deletedCount).toBe(1);

      const remaining = await Notification.find({ recipient: userId });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].type).toBe("system");
    });

    it("throws when olderThan is missing", async () => {
      await expect(repo.deleteOlderThan(null)).rejects.toThrow("olderThan");
    });

    it("throws for invalid date", async () => {
      await expect(repo.deleteOlderThan("not-a-date")).rejects.toThrow("valid date");
    });
  });

  /* -------------------------------------------------------------------- */
  /* softDeleteOlderThan                                                  */
  /* -------------------------------------------------------------------- */

  describe("softDeleteOlderThan", () => {
    it("flags old notifications as deleted instead of removing them", async () => {
      const old = await Notification.create({
        recipient: userId,
        sender: senderId,
        type: "system",
        title: "Old",
        message: "...",
        createdAt: new Date("2020-01-01"),
      });
      await Notification.create({
        recipient: userId,
        sender: senderId,
        type: "system",
        title: "New",
        message: "...",
        createdAt: new Date("2025-01-01"),
      });

      const result = await repo.softDeleteOlderThan(new Date("2023-01-01"));
      expect(result.modifiedCount).toBe(1);

      const check = await Notification.findById(old._id);
      expect(check.isDeleted).toBe(true);

      const remaining = await repo.findByUser(userId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].title).toBe("New");
    });

    it("does not soft-delete already-deleted notifications", async () => {
      await Notification.create({
        recipient: userId,
        sender: senderId,
        type: "system",
        title: "Already deleted",
        message: "...",
        isDeleted: true,
        createdAt: new Date("2020-01-01"),
      });

      const result = await repo.softDeleteOlderThan(new Date("2023-01-01"));
      expect(result.modifiedCount).toBe(0);
    });

    it("throws when olderThan is missing", async () => {
      await expect(repo.softDeleteOlderThan(null)).rejects.toThrow("olderThan");
    });

    it("throws for invalid date", async () => {
      await expect(repo.softDeleteOlderThan("bad")).rejects.toThrow("valid date");
    });
  });

  /* -------------------------------------------------------------------- */
  /* Filtering combinations                                               */
  /* -------------------------------------------------------------------- */

  describe("combined filtering", () => {
    it("filters by type + unread + user simultaneously", async () => {
      await createNotification({ type: "follow", isRead: false });
      await createNotification({ type: "follow", isRead: true });
      await createNotification({ type: "system", isRead: false });

      const results = await repo.findUnread(userId, {
        filter: { type: "follow" },
      });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("follow");
      expect(results[0].isRead).toBe(false);
    });

    it("filters by priority + type + user simultaneously", async () => {
      await createNotification({ type: "follow", priority: "urgent" });
      await createNotification({ type: "follow", priority: "low" });
      await createNotification({ type: "system", priority: "urgent" });

      const results = await repo.findByUser(userId, {
        filter: { type: "follow", priority: "urgent" },
      });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("follow");
      expect(results[0].priority).toBe("urgent");
    });
  });

  /* -------------------------------------------------------------------- */
  /* Exports and constants                                                */
  /* -------------------------------------------------------------------- */

  describe("exports", () => {
    it("exports NOTIFICATION_TYPES as a frozen array", () => {
      expect(Array.isArray(NOTIFICATION_TYPES)).toBe(true);
      expect(Object.isFrozen(NOTIFICATION_TYPES)).toBe(true);
      expect(NOTIFICATION_TYPES).toContain("follow");
      expect(NOTIFICATION_TYPES).toContain("system");
    });

    it("exports NOTIFICATION_PRIORITIES as a frozen array", () => {
      expect(Array.isArray(NOTIFICATION_PRIORITIES)).toBe(true);
      expect(Object.isFrozen(NOTIFICATION_PRIORITIES)).toBe(true);
      expect(NOTIFICATION_PRIORITIES).toContain("low");
      expect(NOTIFICATION_PRIORITIES).toContain("urgent");
    });
  });
});
