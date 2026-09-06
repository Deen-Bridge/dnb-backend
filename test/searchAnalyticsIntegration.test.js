import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import SearchAnalyticsEvent from "../src/models/search-analytics-event.js";

let mongoServer;

const waitForEvents = async (minCount, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    count = await SearchAnalyticsEvent.countDocuments();
    if (count >= minCount) return count;
    await new Promise((r) => setTimeout(r, 50));
  }
  return count;
};

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (process.env.MONGO_URI) {
    try {
      await mongoose.connect(`${process.env.MONGO_URI}_searchanalytics`, {
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

let adminToken;
let studentToken;

beforeEach(async () => {
  await SearchAnalyticsEvent.deleteMany({});
  await Course.deleteMany({});
  await User.deleteMany({});
  const admin = await User.create({
    name: "Data Admin",
    email: "analytics-admin@example.com",
    password: "Qx7#vLmp92Zt",
    role: "admin",
    twoFactor: { enabled: true },
  });
  const student = await User.create({
    name: "Search Student",
    email: "search-student@example.com",
    password: "Qx7#vLmp92Zt",
    role: "student",
    twoFactor: { enabled: false },
  });
  const secret =
    process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";
  adminToken = jwt.sign(
    { userId: admin._id, sessionId: "admin-session", is2FAVerified: true },
    secret
  );
  studentToken = jwt.sign(
    { userId: student._id, sessionId: "student-session" },
    secret
  );
});

describe("Issue #245 — search analytics end-to-end (real /api/search path)", () => {
  it("logs successful searches with a timestamp and result count", async () => {
    await Course.create({
      title: "Fiqh Fundamentals",
      description: "Core jurisprudence",
      category: "Fiqh",
      price: 0,
      createdBy: new mongoose.Types.ObjectId(),
    });

    const res = await request(app).get("/api/search?q=Fi");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // The searchLogger writes asynchronously; wait for it to land.
    const saved = await waitForEvents(1);
    expect(saved).toBeGreaterThanOrEqual(1);

    const event = await SearchAnalyticsEvent.findOne({ query: "Fi" }).lean();
    expect(event).toBeTruthy();
    expect(event.hasResults).toBe(true);
    expect(event.resultCount).toBeGreaterThan(0);
    expect(event.type).toBe("all");
    expect(event.createdAt).toBeInstanceOf(Date); // timestamp recorded
  });

  it("distinguishes and exposes zero-result searches", async () => {
    const search = await request(app).get("/api/search?q=zz");
    expect(search.statusCode).toBe(200);
    expect(search.body.success).toBe(true);

    const saved = await waitForEvents(1);
    expect(saved).toBeGreaterThanOrEqual(1);

    const event = await SearchAnalyticsEvent.findOne({ query: "zz" }).lean();
    expect(event).toBeTruthy();
    expect(event.hasResults).toBe(false);
    expect(event.resultCount).toBe(0);

    // The stored zero-result query is surfaced by the analytics endpoint.
    const res = await request(app)
      .get("/api/analytics/search/zero-results")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const queries = res.body.data.map((q) => q.query);
    expect(queries).toContain("zz");
  });

  it("reports top queries by frequency via the admin endpoint", async () => {
    await request(app).get("/api/search?q=zz");
    await request(app).get("/api/search?q=zz");
    await waitForEvents(2);

    const res = await request(app)
      .get("/api/analytics/search/top")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const top = res.body.data[0];
    expect(top.query).toBe("zz");
    expect(top.count).toBeGreaterThanOrEqual(2);
  });

  it("guards the analytics endpoints (401 anonymous, 403 non-admin)", async () => {
    const anon = await request(app).get("/api/analytics/search/top");
    expect(anon.statusCode).toBe(401);

    const forbidden = await request(app)
      .get("/api/analytics/search/top")
      .set("Authorization", `Bearer ${studentToken}`);
    expect(forbidden.statusCode).toBe(403);
  });
});