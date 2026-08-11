import { jest } from "@jest/globals";
import express from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import Book from "../src/models/Book.js";
import {
  sseNotifications,
  getUserNotifications,
  createFollowNotification,
  createUnfollowNotification,
  createNewCourseNotification,
  createNewBookNotification,
} from "../src/controllers/notificationController.js";

describe("Notification System & Event Wiring", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await Notification.deleteMany({});
    await User.deleteMany({});
    await Course.deleteMany({});
    await Book.deleteMany({});
  });

  describe("Mongoose Schema Compound Indexes", () => {
    it("has expected compound indexes declared on Notification schema", () => {
      const indexes = Notification.schema.indexes();
      const indexFields = indexes.map(([spec]) => Object.keys(spec).join(","));

      expect(indexFields).toContain("recipient,createdAt");
      expect(indexFields).toContain("recipient,isRead");
      expect(indexFields).toContain("recipient,isDeleted");
    });
  });

  describe("Event Producer Notifications", () => {
    it("creates a follow notification for the followed user", async () => {
      const follower = await User.create({
        name: "Follower User",
        email: "follower@example.com",
        password: "Qx7#vLmp92Zt",
      });

      const followed = await User.create({
        name: "Followed User",
        email: "followed@example.com",
        password: "Qx7#vLmp92Zt",
      });

      await createFollowNotification(follower._id, followed._id);

      const notifs = await Notification.find({ recipient: followed._id });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].type).toBe("follow");
      expect(notifs[0].sender.toString()).toBe(follower._id.toString());
      expect(notifs[0].message).toContain("Follower User started following you");
    });

    it("creates an unfollow notification for the unfollowed user", async () => {
      const unfollower = await User.create({
        name: "Unfollower User",
        email: "unfollower@example.com",
        password: "Qx7#vLmp92Zt",
      });

      const unfollowed = await User.create({
        name: "Unfollowed User",
        email: "unfollowed@example.com",
        password: "Qx7#vLmp92Zt",
      });

      await createUnfollowNotification(unfollower._id, unfollowed._id);

      const notifs = await Notification.find({ recipient: unfollowed._id });
      expect(notifs).toHaveLength(1);
      expect(notifs[0].type).toBe("unfollow");
      expect(notifs[0].sender.toString()).toBe(unfollower._id.toString());
      expect(notifs[0].message).toContain("Unfollower User unfollowed you");
    });

    it("creates batched new_course notifications for all followers", async () => {
      const follower1 = await User.create({
        name: "Follower 1",
        email: "f1@example.com",
        password: "Qx7#vLmp92Zt",
      });
      const follower2 = await User.create({
        name: "Follower 2",
        email: "f2@example.com",
        password: "Qx7#vLmp92Zt",
      });

      const creator = await User.create({
        name: "Course Creator",
        email: "creator@example.com",
        password: "Qx7#vLmp92Zt",
        followers: [follower1._id, follower2._id],
      });

      const course = await Course.create({
        title: "Mastering Node.js",
        description: "Comprehensive Node.js course",
        category: "Programming",
        createdBy: creator._id,
      });

      const result = await createNewCourseNotification(
        course._id,
        creator._id,
        course.title
      );

      expect(result).toHaveLength(2);

      const notifs = await Notification.find({ sender: creator._id });
      expect(notifs).toHaveLength(2);
      const recipientIds = notifs.map((n) => n.recipient.toString());
      expect(recipientIds).toContain(follower1._id.toString());
      expect(recipientIds).toContain(follower2._id.toString());
      expect(notifs[0].type).toBe("new_course");
      expect(notifs[0].message).toContain("Course Creator created a new course: Mastering Node.js");
    });

    it("creates batched new_book notifications for all followers", async () => {
      const follower1 = await User.create({
        name: "Book Reader 1",
        email: "r1@example.com",
        password: "Qx7#vLmp92Zt",
      });
      const follower2 = await User.create({
        name: "Book Reader 2",
        email: "r2@example.com",
        password: "Qx7#vLmp92Zt",
      });

      const author = await User.create({
        name: "Book Author",
        email: "author@example.com",
        password: "Qx7#vLmp92Zt",
        followers: [follower1._id, follower2._id],
      });

      const book = await Book.create({
        title: "Clean Architecture in JS",
        description: "Guide to scalable code architecture",
        category: "Tech",
        price: 15,
        author: author._id,
        thumbnail: "https://example.com/thumb.jpg",
        image: "https://example.com/thumb.jpg",
        fileUrl: "https://example.com/book.pdf",
      });

      const result = await createNewBookNotification(
        book._id,
        author._id,
        book.title
      );

      expect(result).toHaveLength(2);

      const notifs = await Notification.find({ sender: author._id });
      expect(notifs).toHaveLength(2);
      const recipientIds = notifs.map((n) => n.recipient.toString());
      expect(recipientIds).toContain(follower1._id.toString());
      expect(recipientIds).toContain(follower2._id.toString());
      expect(notifs[0].type).toBe("new_book");
      expect(notifs[0].message).toContain("Book Author published a new book: Clean Architecture in JS");
    });
  });

  describe("getUserNotifications Pagination & Bounding", () => {
    it("caps limit to 100 and validates invalid page/limit params", async () => {
      const recipient = await User.create({
        name: "Recipient User",
        email: "recipient@example.com",
        password: "Qx7#vLmp92Zt",
      });

      const sender = await User.create({
        name: "Sender User",
        email: "sender@example.com",
        password: "Qx7#vLmp92Zt",
      });

      // Insert 120 notifications for recipient
      const docs = Array.from({ length: 120 }, (_, i) => ({
        recipient: recipient._id,
        sender: sender._id,
        type: "system",
        title: `Notification ${i + 1}`,
        message: `Message ${i + 1}`,
      }));

      await Notification.insertMany(docs);

      // Request with limit=500 -> should be capped at 100
      const reqLarge = {
        user: { _id: recipient._id },
        query: { limit: "500", page: "1" },
      };

      const resLarge = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await getUserNotifications(reqLarge, resLarge);

      expect(resLarge.status).toHaveBeenCalledWith(200);
      const dataLarge = resLarge.json.mock.calls[0][0];
      expect(dataLarge.notifications).toHaveLength(100);
      expect(dataLarge.pagination.currentPage).toBe(1);

      // Request with negative page and non-numeric limit -> should default to page=1, limit=20
      const reqInvalid = {
        user: { _id: recipient._id },
        query: { limit: "invalid", page: "-5" },
      };

      const resInvalid = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await getUserNotifications(reqInvalid, resInvalid);

      const dataInvalid = resInvalid.json.mock.calls[0][0];
      expect(dataInvalid.notifications).toHaveLength(20);
      expect(dataInvalid.pagination.currentPage).toBe(1);
    });
  });

  describe("SSE Connection & Delivery", () => {
    it("establishes SSE connection stream and handles payload delivery", async () => {
      const user = await User.create({
        name: "SSE User",
        email: "sse@example.com",
        password: "Qx7#vLmp92Zt",
      });

      const writeHeadMock = jest.fn();
      const writeMock = jest.fn();
      const reqMock = {
        user: { _id: user._id },
        on: jest.fn(),
      };
      const resMock = {
        writeHead: writeHeadMock,
        write: writeMock,
      };

      await sseNotifications(reqMock, resMock);

      expect(writeHeadMock).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          "Content-Type": "text/event-stream",
        })
      );
      expect(writeMock).toHaveBeenCalledWith(
        expect.stringContaining("Connected to notifications")
      );
    });
  });
});
