import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import CourseProgress from "../src/models/CourseProgress.js";

describe("Course progress endpoints", () => {
  let mongoServer;
  let ownerToken;
  let learnerToken;
  let owner;
  let learner;

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
    await Promise.all([
      User.deleteMany({}),
      Course.deleteMany({}),
      CourseProgress.deleteMany({}),
    ]);

    owner = await User.create({
      name: "Owner",
      email: "owner@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
    });
    learner = await User.create({
      name: "Learner",
      email: "learner@example.com",
      password: "Qx7#vLmp92Zt",
      role: "student",
    });

    ownerToken = jwt.sign({ userId: owner._id, sessionId: "o1" }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024");
    learnerToken = jwt.sign({ userId: learner._id, sessionId: "l1" }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024");
  });

  it("creates progress for a learner and computes percent completion idempotently", async () => {
    const course = await Course.create({
      title: "Course 1",
      description: "Test",
      category: "Tech",
      createdBy: owner._id,
      video: "video-url",
      sections: [
        { title: "Section 1", order: 1, lessons: [{ _id: new mongoose.Types.ObjectId(), title: "Lesson 1", order: 1, videoUrl: "v1" }] },
      ],
    });

    await Course.updateOne({ _id: course._id }, { $addToSet: { enrolledUsers: learner._id } });

    const createRes = await request(app)
      .post(`/api/courses/${course._id}/progress`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({ lessonId: course.sections[0].lessons[0]._id.toString(), lastPositionSeconds: 90 });

    expect(createRes.status).toBe(200);
    expect(createRes.body.progress.percentComplete).toBe(100);

    const duplicateRes = await request(app)
      .post(`/api/courses/${course._id}/progress`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({ lessonId: course.sections[0].lessons[0]._id.toString(), lastPositionSeconds: 120 });

    expect(duplicateRes.status).toBe(200);
    expect(duplicateRes.body.progress.lessonsCompleted).toHaveLength(1);
    expect(duplicateRes.body.progress.percentComplete).toBe(100);
  });

  it("returns the learning dashboard for the authenticated user", async () => {
    const course = await Course.create({
      title: "Dashboard course",
      description: "Test",
      category: "Tech",
      createdBy: owner._id,
      video: "video-url",
      sections: [
        { title: "Section 1", order: 1, lessons: [{ _id: new mongoose.Types.ObjectId(), title: "Lesson 1", order: 1, videoUrl: "v1" }, { _id: new mongoose.Types.ObjectId(), title: "Lesson 2", order: 2, videoUrl: "v2" }] },
      ],
    });

    await Course.updateOne({ _id: course._id }, { $addToSet: { enrolledUsers: learner._id } });
    await CourseProgress.create({
      user: learner._id,
      course: course._id,
      lessonsCompleted: [course.sections[0].lessons[0]._id],
      lastLesson: course.sections[0].lessons[0]._id,
      lastPositionSeconds: 50,
      percentComplete: 50,
      completedAt: null,
      updatedAt: new Date(),
    });

    const res = await request(app)
      .get("/api/users/me/learning")
      .set("Authorization", `Bearer ${learnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.courses).toHaveLength(1);
    expect(res.body.courses[0].percentComplete).toBe(50);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });
});

