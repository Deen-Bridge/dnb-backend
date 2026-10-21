import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import CourseProgress from "../src/models/CourseProgress.js";

// Complements test/courseProgress.test.js (POST happy path + learning dashboard).
// Adds GET /api/courses/:id/progress and failure-path coverage for both endpoints.
describe("Course progress endpoints contract", () => {
  let mongoServer;
  let token;
  let user;
  let course;
  let lessonIds;

  const secret = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (process.env.MONGO_URI) {
      try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 2000 });
        return;
      } catch (_err) {}
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Course.deleteMany({}), CourseProgress.deleteMany({})]);
    user = await User.create({
      name: "Learner",
      email: "learner-ep@example.com",
      password: "Qx7#vLmp92Zt",
      role: "student",
    });
    token = jwt.sign({ userId: user._id, sessionId: "s1" }, secret);
    lessonIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    course = await Course.create({
      title: "Progress course",
      description: "Test",
      category: "Tech",
      createdBy: user._id,
      video: "video-url",
      sections: [
        {
          title: "Section 1",
          order: 1,
          lessons: [
            { _id: lessonIds[0], title: "Lesson 1", order: 1, videoUrl: "v1" },
            { _id: lessonIds[1], title: "Lesson 2", order: 2, videoUrl: "v2" },
          ],
        },
      ],
    });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe("GET /api/courses/:id/progress", () => {
    it("returns success with null progress when nothing is recorded", async () => {
      const res = await request(app)
        .get(`/api/courses/${course._id}/progress`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, progress: null });
    });

    it("returns the stored progress for the authenticated user", async () => {
      await CourseProgress.create({
        user: user._id,
        course: course._id,
        lessonsCompleted: [lessonIds[0]],
        lastLesson: lessonIds[0],
        lastPositionSeconds: 42,
        percentComplete: 50,
      });
      const res = await request(app)
        .get(`/api/courses/${course._id}/progress`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.progress.percentComplete).toBe(50);
      expect(res.body.progress.lastPositionSeconds).toBe(42);
      expect(res.body.progress.lessonsCompleted).toHaveLength(1);
    });

    it("does not leak another user's progress", async () => {
      const other = await User.create({
        name: "Other",
        email: "other-ep@example.com",
        password: "Qx7#vLmp92Zt",
        role: "student",
      });
      await CourseProgress.create({ user: other._id, course: course._id, percentComplete: 100 });
      const res = await request(app)
        .get(`/api/courses/${course._id}/progress`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.progress).toBeNull();
    });

    it("rejects unauthenticated requests", async () => {
      const res = await request(app).get(`/api/courses/${course._id}/progress`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/courses/:id/progress", () => {
    it("records a lesson and computes partial percent complete", async () => {
      const res = await request(app)
        .post(`/api/courses/${course._id}/progress`)
        .set("Authorization", `Bearer ${token}`)
        .send({ lessonId: lessonIds[0].toString(), lastPositionSeconds: 30 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.progress.percentComplete).toBe(50);
      expect(res.body.progress.lastPositionSeconds).toBe(30);
      expect(res.body.progress.completedAt).toBeFalsy();
    });

    it("accumulates lessons and marks the course complete", async () => {
      for (const id of lessonIds) {
        await request(app)
          .post(`/api/courses/${course._id}/progress`)
          .set("Authorization", `Bearer ${token}`)
          .send({ lessonId: id.toString() });
      }
      const res = await request(app)
        .get(`/api/courses/${course._id}/progress`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.body.progress.percentComplete).toBe(100);
      expect(res.body.progress.completedAt).toBeTruthy();
      expect(res.body.progress.lessonsCompleted).toHaveLength(2);
    });

    it("returns 404 with the standard error shape for an unknown course", async () => {
      const res = await request(app)
        .post(`/api/courses/${new mongoose.Types.ObjectId()}/progress`)
        .set("Authorization", `Bearer ${token}`)
        .send({ lessonId: lessonIds[0].toString() });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, message: "Course not found" });
    });

    it("returns 400 when the lesson is not part of the course", async () => {
      const res = await request(app)
        .post(`/api/courses/${course._id}/progress`)
        .set("Authorization", `Bearer ${token}`)
        .send({ lessonId: new mongoose.Types.ObjectId().toString() });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: "Lesson not found" });
    });

    it("returns 400 when lessonId is missing", async () => {
      const res = await request(app)
        .post(`/api/courses/${course._id}/progress`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 when the course has no lessons", async () => {
      const empty = await Course.create({
        title: "Empty",
        description: "Test",
        category: "Tech",
        createdBy: user._id,
        video: "video-url",
        sections: [],
      });
      const res = await request(app)
        .post(`/api/courses/${empty._id}/progress`)
        .set("Authorization", `Bearer ${token}`)
        .send({ lessonId: lessonIds[0].toString() });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: "Course has no lessons" });
    });

    it("rejects unauthenticated requests", async () => {
      const res = await request(app)
        .post(`/api/courses/${course._id}/progress`)
        .send({ lessonId: lessonIds[0].toString() });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/progress/courses (frontend-expected route)", () => {
    // GAP: the frontend calls GET /api/progress/courses but the backend only
    // exposes /api/courses/:id/progress and /api/users/me/learning. The route
    // is not mounted, so the request 404s. Pin the current behavior; when the
    // route is implemented, replace this test with the intended contract.
    it("currently 404s because the route is not implemented", async () => {
      const res = await request(app)
        .get("/api/progress/courses")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it.todo("returns the authenticated user's progress for all courses once /api/progress/courses exists");
  });
});
