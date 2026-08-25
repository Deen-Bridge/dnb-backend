import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import Course from "../src/models/Course.js";
import CourseProgress from "../src/models/CourseProgress.js";
import Badge from "../src/models/badge.model.js";
import UserBadge from "../src/models/user-badge.model.js";
import User from "../src/models/User.js";
import badgeService from "../src/services/badge.service.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";

describe("Course Badges API", () => {
  let mongoServer;
  let token;
  let user;

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

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await UserBadge.deleteMany({});
    await Badge.deleteMany({});
    await CourseProgress.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    const auth = await seedUserAndLogin(app, { email: "badge_student@example.com" });
    token = auth.token;
    user = auth.user;
  });

  it("should seed default badges and return all badge definitions", async () => {
    const res = await request(app).get("/api/badges");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("should automatically award First Steps badge when user completes 1 course", async () => {
    const course = await Course.create({
      title: "Introduction to Islam",
      description: "Basics of faith",
      category: "Theology",
      createdBy: user._id,
    });

    await CourseProgress.create({
      user: user._id,
      course: course._id,
      percentComplete: 100,
      completedAt: new Date(),
    });

    const userBadges = await badgeService.getUserBadges(user._id);
    expect(userBadges).toHaveLength(1);
    expect(userBadges[0].badge.slug).toBe("first-course");
  });

  it("should fetch user badges via API endpoint", async () => {
    const course = await Course.create({
      title: "Fiqh 101",
      description: "Introductory Fiqh",
      category: "Fiqh",
      createdBy: user._id,
    });

    await CourseProgress.create({
      user: user._id,
      course: course._id,
      percentComplete: 100,
      completedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/badges/user/${user._id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});
