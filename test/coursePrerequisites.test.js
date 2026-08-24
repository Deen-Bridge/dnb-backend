import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import CourseProgress from "../src/models/CourseProgress.js";

describe("Course prerequisites enrollment gate", () => {
  let mongoServer;
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

    learnerToken = jwt.sign(
      { userId: learner._id, sessionId: "l1" },
      process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024"
    );
  });

  it("blocks enrollment when a prerequisite is not completed", async () => {
    const prereq = await Course.create({
      title: "Intro to Fiqh",
      description: "Basics",
      category: "Tech",
      createdBy: owner._id,
    });
    const advanced = await Course.create({
      title: "Advanced Fiqh",
      description: "Deep dive",
      category: "Tech",
      createdBy: owner._id,
      prerequisites: [prereq._id],
    });

    const res = await request(app)
      .post(`/api/courses/${advanced._id}/enroll`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Complete these prerequisites first");
    expect(res.body.message).toContain("Intro to Fiqh");

    const refreshed = await Course.findById(advanced._id);
    expect(refreshed.enrolledUsers.map(String)).not.toContain(
      learner._id.toString()
    );
  });

  it("allows enrollment once the prerequisite is completed", async () => {
    const prereq = await Course.create({
      title: "Intro to Fiqh",
      description: "Basics",
      category: "Tech",
      createdBy: owner._id,
    });
    const advanced = await Course.create({
      title: "Advanced Fiqh",
      description: "Deep dive",
      category: "Tech",
      createdBy: owner._id,
      prerequisites: [prereq._id],
    });

    await CourseProgress.create({
      user: learner._id,
      course: prereq._id,
      percentComplete: 100,
      completedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/courses/${advanced._id}/enroll`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const refreshed = await Course.findById(advanced._id);
    expect(refreshed.enrolledUsers.map(String)).toContain(
      learner._id.toString()
    );
  });

  it("returns prerequisites (id + title) on the course detail endpoint", async () => {
    const prereq = await Course.create({
      title: "Intro to Fiqh",
      description: "Basics",
      category: "Tech",
      createdBy: owner._id,
    });
    const advanced = await Course.create({
      title: "Advanced Fiqh",
      description: "Deep dive",
      category: "Tech",
      createdBy: owner._id,
      prerequisites: [prereq._id],
    });

    const res = await request(app).get(`/api/courses/${advanced._id}`);

    expect(res.status).toBe(200);
    expect(res.body.course.prerequisites).toHaveLength(1);
    expect(res.body.course.prerequisites[0].title).toBe("Intro to Fiqh");
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
