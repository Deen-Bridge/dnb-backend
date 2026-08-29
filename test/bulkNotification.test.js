import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import CourseProgress from "../src/models/CourseProgress.js";
import Notification from "../src/models/Notification.js";
import AuditLog, { AUDIT_ACTIONS } from "../src/models/AuditLog.js";
import { waitForIdle, resetInlineQueueForTests } from "../src/jobs/queue.js";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

const mintToken = (user) =>
  jwt.sign(
    { userId: user._id, role: user.role, sessionId: "sess-1", is2FAVerified: true },
    JWT_SECRET,
    { expiresIn: "15m" }
  );

describe("Bulk Notification for Mentors (Issue #123)", () => {
  let mongoServer;
  let mentor, otherMentor, admin, student1, student2;
  let course;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  beforeEach(async () => {
    resetInlineQueueForTests();
    await Promise.all([
      User.deleteMany({}),
      Course.deleteMany({}),
      CourseProgress.deleteMany({}),
      Notification.deleteMany({}),
      mongoose.connection.collection("auditlogs").deleteMany({}),
    ]);

    mentor = await User.create({
      name: "Sheikh Mentor",
      email: "mentor@example.com",
      password: "password123",
      role: "mentor",
      twoFactor: { enabled: false },
    });

    otherMentor = await User.create({
      name: "Other Mentor",
      email: "other_mentor@example.com",
      password: "password123",
      role: "mentor",
      twoFactor: { enabled: false },
    });

    admin = await User.create({
      name: "Admin User",
      email: "admin@example.com",
      password: "password123",
      role: "admin",
      twoFactor: { enabled: true },
    });

    student1 = await User.create({
      name: "Student One",
      email: "student1@example.com",
      password: "password123",
      role: "student",
    });

    student2 = await User.create({
      name: "Student Two",
      email: "student2@example.com",
      password: "password123",
      role: "student",
    });

    course = await Course.create({
      title: "Introduction to Tajweed",
      description: "Learn Tajweed rules",
      category: "Quran",
      createdBy: mentor._id,
      enrolledUsers: [student1._id],
    });

    await CourseProgress.create({
      user: student2._id,
      course: course._id,
      percentComplete: 50,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/api/notifications/bulk")
      .send({
        course_id: course._id.toString(),
        title: "New Lesson Available",
        message: "Lesson 5 on Tajweed rules is now available",
      });

    expect(res.status).toBe(401);
  });

  it("rejects student role with 403", async () => {
    const token = mintToken(student1);
    const res = await request(app)
      .post("/api/notifications/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({
        course_id: course._id.toString(),
        title: "New Lesson Available",
        message: "Lesson 5 on Tajweed rules is now available",
      });

    expect(res.status).toBe(403);
  });

  it("rejects mentor who is not the course creator with 403", async () => {
    const token = mintToken(otherMentor);
    const res = await request(app)
      .post("/api/notifications/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({
        course_id: course._id.toString(),
        title: "New Lesson Available",
        message: "Lesson 5 on Tajweed rules is now available",
      });

    expect(res.status).toBe(403);
  });

  it("queues bulk notification for course creator mentor and fans out to enrolled students", async () => {
    const token = mintToken(mentor);
    const res = await request(app)
      .post("/api/notifications/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({
        course_id: course._id.toString(),
        title: "New Lesson Available",
        message: "Lesson 5 on Tajweed rules is now available",
        type: "course_update",
      });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.jobId).toBeDefined();

    // Wait for queue processing
    await waitForIdle();

    const notifications = await Notification.find({ "data.courseId": course._id });
    expect(notifications.length).toBe(2);

    const recipientIds = notifications.map((n) => n.recipient.toString());
    expect(recipientIds).toContain(student1._id.toString());
    expect(recipientIds).toContain(student2._id.toString());
    expect(notifications[0].title).toBe("New Lesson Available");
    expect(notifications[0].type).toBe("course_update");

    // Verify audit log
    const audit = await AuditLog.findOne({
      action: AUDIT_ACTIONS.NOTIFICATION_BULK_SENT,
      targetId: course._id.toString(),
    });
    expect(audit).not.toBeNull();
    expect(audit.actor.toString()).toBe(mentor._id.toString());
  });

  it("allows admin to send bulk notifications to any course", async () => {
    const token = mintToken(admin);
    const res = await request(app)
      .post("/api/notifications/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({
        course_id: course._id.toString(),
        title: "Important Admin Notice",
        message: "Course schedule has been updated",
      });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);

    await waitForIdle();
    const notifications = await Notification.find({ title: "Important Admin Notice" });
    expect(notifications.length).toBe(2);
  });

  it("validates missing fields with 400", async () => {
    const token = mintToken(mentor);
    const res = await request(app)
      .post("/api/notifications/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({
        course_id: course._id.toString(),
        // missing title & message
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
