import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import UserJourneyEvent from "../src/models/user-journey-event.js";

let mongoServer;

const waitForEvent = async (filter, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  let doc = null;
  while (Date.now() < deadline) {
    doc = await UserJourneyEvent.findOne(filter).lean();
    if (doc) return doc;
    await new Promise((r) => setTimeout(r, 50));
  }
  return doc;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (process.env.MONGO_URI) {
    try {
      await mongoose.connect(`${process.env.MONGO_URI}_journey`, {
        serverSelectionTimeoutMS: 2000,
      });
      return;
    } catch (_err) {}
  }
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 60000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

let token;
let learnerId;

beforeEach(async () => {
  await UserJourneyEvent.deleteMany({});
  await User.deleteMany({});
  await Course.deleteMany({});
  learnerId = new mongoose.Types.ObjectId();
  await User.create({
    _id: learnerId,
    name: "Journey Learner",
    email: "journey-learner@example.com",
    password: "Qx7#vLmp92Zt",
    role: "student",
  });
  token = jwt.sign(
    { userId: learnerId, sessionId: "integration-session" },
    process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024"
  );
});

describe("Issue #246 — user journey tracking end-to-end (real paths)", () => {
  it("captures a page visit for a real navigation (GET /api/courses)", async () => {
    const res = await request(app)
      .get("/api/courses")
      .set("x-session-id", "page-visit-session");
    expect(res.statusCode).toBe(200);

    const event = await waitForEvent({ sessionId: "page-visit-session" });
    expect(event).toBeTruthy();
    expect(event.eventType).toBe("page_visit");
    expect(event.page).toBe("/api/courses");
    expect(event.createdAt).toBeInstanceOf(Date); // timestamp stored
  });

  it("captures a key user action for a real POST (enroll in a course)", async () => {
    const owner = await User.create({
      name: "Course Owner",
      email: "course-owner@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
    });
    const course = await Course.create({
      title: "Tafsir Essentials",
      description: "Quranic exegesis",
      category: "Tafsir",
      price: 0,
      createdBy: owner._id,
    });

    const res = await request(app)
      .post(`/api/courses/${course._id}/enroll`)
      .set("Authorization", `Bearer ${token}`)
      .set("x-session-id", "integration-session")
      .send({});
    expect([200, 201]).toContain(res.statusCode);

    const event = await waitForEvent({
      sessionId: "integration-session",
      eventType: "action",
    });
    expect(event).toBeTruthy();
    expect(event.action).toBe("enroll_course");
  });

  it("exposes a user's journey chronologically (GET /api/analytics/journey)", async () => {
    await UserJourneyEvent.create([
      {
        userId: learnerId,
        sessionId: "integration-session",
        eventType: "page_visit",
        page: "/home",
        createdAt: new Date(Date.now() - 2000),
      },
      {
        userId: learnerId,
        sessionId: "integration-session",
        eventType: "page_visit",
        page: "/courses",
        createdAt: new Date(Date.now() - 1000),
      },
    ]);

    const res = await request(app)
      .get("/api/analytics/journey")
      .set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((e) => e.page)).toEqual(["/home", "/courses"]);
    expect(res.body.pagination.total).toBe(2);
  });

  it("identifies common flow patterns (transitions) across sessions", async () => {
    const mk = (sessionId, page, createdAgoMs) => ({
      sessionId,
      page,
      eventType: "page_visit",
      createdAt: new Date(Date.now() - createdAgoMs),
    });
    await UserJourneyEvent.create([
      mk("flowA", "/home", 3000),
      mk("flowA", "/courses", 2000),
      mk("flowA", "/course/1", 1000),
      mk("flowB", "/home", 3000),
      mk("flowB", "/courses", 2000),
      mk("flowC", "/home", 3000),
      mk("flowC", "/courses", 2000),
    ]);

    const res = await request(app)
      .get("/api/analytics/journey/patterns")
      .set("Authorization", `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0]).toEqual({ from: "/home", to: "/courses", count: 3 });
  });

  it("guards the analytics endpoints (401 anonymous)", async () => {
    const res = await request(app).get("/api/analytics/journey");
    expect(res.statusCode).toBe(401);
  });
});