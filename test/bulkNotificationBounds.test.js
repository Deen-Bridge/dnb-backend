import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import Course from "../src/models/Course.js";
import CourseProgress from "../src/models/CourseProgress.js";
import Notification from "../src/models/Notification.js";
import User from "../src/models/User.js";
import { waitForIdle, resetInlineQueueForTests } from "../src/jobs/queue.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";
import {
  BULK_NOTIFICATION_LIMITS,
  BULK_NOTIFICATION_TYPES,
} from "../src/controllers/notificationController.js";

/**
 * Issue #645 — bulk notification payloads and fan-out cost must be bounded
 * before the request reaches the queue.
 */
describe("Bulk notification bounds (#645)", () => {
  let mongoServer;
  let mentor;
  let mentorToken;
  let course;

  const bulkUrl = "/api/notifications/bulk";

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    resetInlineQueueForTests();
    await Promise.all([
      Notification.deleteMany({}),
      CourseProgress.deleteMany({}),
      Course.deleteMany({}),
      User.deleteMany({}),
    ]);

    const auth = await seedUserAndLogin(app, {
      email: "budget_mentor@example.com",
      role: "mentor",
    });
    mentor = auth.user;
    mentorToken = auth.token;

    course = await Course.create({
      title: "Fiqh of Worship",
      description: "Course used by the bulk notification bounds suite",
      category: "fiqh",
      createdBy: mentor._id,
    });
  });

  const post = (body) =>
    request(app).post(bulkUrl).set("Authorization", `Bearer ${mentorToken}`).send(body);

  it("exposes the documented limits", () => {
    expect(BULK_NOTIFICATION_LIMITS.maxTitleLength).toBe(120);
    expect(BULK_NOTIFICATION_LIMITS.maxMessageLength).toBe(2000);
    expect(BULK_NOTIFICATION_LIMITS.maxRecipients).toBe(1000);
    expect(BULK_NOTIFICATION_TYPES).toContain("course_update");
    expect(BULK_NOTIFICATION_TYPES).not.toContain("follow");
  });

  it("rejects a title over the character limit and queues nothing", async () => {
    const res = await post({
      course_id: course._id.toString(),
      title: "x".repeat(BULK_NOTIFICATION_LIMITS.maxTitleLength + 1),
      message: "Body",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain(String(BULK_NOTIFICATION_LIMITS.maxTitleLength));

    await waitForIdle();
    expect(await Notification.countDocuments({})).toBe(0);
  });

  it("rejects a message over the character limit", async () => {
    const res = await post({
      course_id: course._id.toString(),
      title: "Valid title",
      message: "y".repeat(BULK_NOTIFICATION_LIMITS.maxMessageLength + 1),
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain(String(BULK_NOTIFICATION_LIMITS.maxMessageLength));
  });

  it("rejects a notification type outside the campaign allow-list", async () => {
    const res = await post({
      course_id: course._id.toString(),
      title: "Valid title",
      message: "Valid message",
      type: "follow",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("course_update");
  });

  it("rejects a campaign for a course with no recipients", async () => {
    const res = await post({
      course_id: course._id.toString(),
      title: "Valid title",
      message: "Valid message",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/no recipients/i);
  });

  it("trims content, reports the recipient count and delivers to every recipient", async () => {
    const student = await User.create({
      name: "Student One",
      email: "budget_student@example.com",
      password: "Qx7#vLmp92Zt",
      role: "student",
    });

    course.enrolledUsers = [student._id];
    await course.save();

    // A second recipient who only has course progress recorded.
    const progressOnly = new mongoose.Types.ObjectId();
    await CourseProgress.create({
      user: progressOnly,
      course: course._id,
      percentComplete: 25,
    });

    const res = await post({
      course_id: course._id.toString(),
      title: "  Lesson 5 is live  ",
      message: "  The fifth lesson is now available.  ",
    });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.recipientCount).toBe(2);

    await waitForIdle();

    const delivered = await Notification.find({ "data.courseId": course._id });
    expect(delivered).toHaveLength(2);
    expect(delivered[0].title).toBe("Lesson 5 is live");
    expect(delivered[0].message).toBe("The fifth lesson is now available.");
    expect(delivered[0].type).toBe("course_update");
  });

  it("refuses a campaign that exceeds the recipient ceiling", async () => {
    const overLimit = BULK_NOTIFICATION_LIMITS.maxRecipients + 1;
    await CourseProgress.insertMany(
      Array.from({ length: overLimit }, () => ({
        user: new mongoose.Types.ObjectId(),
        course: course._id,
        percentComplete: 10,
      }))
    );

    const res = await post({
      course_id: course._id.toString(),
      title: "Valid title",
      message: "Valid message",
    });

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain(String(overLimit));
    expect(res.body.message).toContain(String(BULK_NOTIFICATION_LIMITS.maxRecipients));

    await waitForIdle();
    expect(await Notification.countDocuments({})).toBe(0);
  }, 60000);
});
