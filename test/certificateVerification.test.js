import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import CourseProgress from "../src/models/CourseProgress.js";
import Certificate from "../src/models/certificate.model.js";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

const mintToken = (user) =>
  jwt.sign(
    { userId: user._id, role: user.role, sessionId: "sess-1", is2FAVerified: true },
    JWT_SECRET,
    { expiresIn: "15m" }
  );

describe("Course Completion Certificates (Issue #125)", () => {
  let mongoServer;
  let mentor, student;
  let course;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Course.deleteMany({}),
      CourseProgress.deleteMany({}),
      Certificate.deleteMany({}),
    ]);

    mentor = await User.create({
      name: "Sheikh Muhammad",
      email: "sheikh@example.com",
      password: "password123",
      role: "mentor",
    });

    student = await User.create({
      name: "Ahmed Khan",
      email: "ahmed@example.com",
      password: "password123",
      role: "student",
    });

    course = await Course.create({
      title: "Introduction to Tajweed",
      description: "Comprehensive Tajweed course",
      category: "Quran",
      createdBy: mentor._id,
      enrolledUsers: [student._id],
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it("rejects unauthenticated certificate generation with 401", async () => {
    const res = await request(app).post(`/api/courses/${course._id}/certificate`);
    expect(res.status).toBe(401);
  });

  it("rejects certificate generation if course is not completed yet", async () => {
    await CourseProgress.create({
      user: student._id,
      course: course._id,
      percentComplete: 75,
      completedAt: null,
    });

    const token = mintToken(student);
    const res = await request(app)
      .post(`/api/courses/${course._id}/certificate`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not been completed/i);
  });

  it("generates verifiable certificate upon 100% course completion", async () => {
    const completedDate = new Date("2026-08-15T00:00:00.000Z");
    await CourseProgress.create({
      user: student._id,
      course: course._id,
      percentComplete: 100,
      completedAt: completedDate,
    });

    const token = mintToken(student);
    const res = await request(app)
      .post(`/api/courses/${course._id}/certificate`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.valid).toBe(true);
    expect(res.body.certificate).toBeDefined();
    expect(res.body.certificate.student).toBe("Ahmed Khan");
    expect(res.body.certificate.course).toBe("Introduction to Tajweed");
    expect(res.body.certificate.educator).toBe("Sheikh Muhammad");
    expect(res.body.certificate.completed_at).toBe("2026-08-15");
    expect(res.body.certificate.stellar_tx).toBeDefined();

    const certId = res.body.certificate.id;

    // Verify duplicate prevention
    const duplicateRes = await request(app)
      .post(`/api/courses/${course._id}/certificate`)
      .set("Authorization", `Bearer ${token}`);

    expect(duplicateRes.status).toBe(201);
    expect(duplicateRes.body.certificate.id).toBe(certId);

    const count = await Certificate.countDocuments({ user: student._id, course: course._id });
    expect(count).toBe(1);
  });

  it("allows public verification without authentication via GET /api/certificates/:id", async () => {
    const completedDate = new Date("2026-08-15T00:00:00.000Z");
    await CourseProgress.create({
      user: student._id,
      course: course._id,
      percentComplete: 100,
      completedAt: completedDate,
    });

    const token = mintToken(student);
    const createRes = await request(app)
      .post(`/api/courses/${course._id}/certificate`)
      .set("Authorization", `Bearer ${token}`);

    const certId = createRes.body.certificate.id;

    // Public verification call without auth header
    const verifyRes = await request(app).get(`/api/certificates/${certId}`);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.valid).toBe(true);
    expect(verifyRes.body.certificate).toEqual({
      id: certId,
      student: "Ahmed Khan",
      course: "Introduction to Tajweed",
      educator: "Sheikh Muhammad",
      completed_at: "2026-08-15",
      stellar_tx: expect.any(String),
    });
  });

  it("downloads PDF certificate with QR code via GET /api/certificates/:id/download", async () => {
    await CourseProgress.create({
      user: student._id,
      course: course._id,
      percentComplete: 100,
      completedAt: new Date(),
    });

    const token = mintToken(student);
    const createRes = await request(app)
      .post(`/api/courses/${course._id}/certificate`)
      .set("Authorization", `Bearer ${token}`);

    const certId = createRes.body.certificate.id;

    const downloadRes = await request(app).get(`/api/certificates/${certId}/download`);

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers["content-type"]).toBe("application/pdf");
    expect(downloadRes.headers["content-disposition"]).toContain(certId);
    expect(downloadRes.body.length).toBeGreaterThan(1000);
  });
});
