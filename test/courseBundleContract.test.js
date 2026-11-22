import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import app from "../app.js";
import Course from "../src/models/Course.js";
import CourseBundle from "../src/models/course-bundle.model.js";
import User from "../src/models/User.js";
import courseBundleService from "../src/services/course-bundle.service.js";
import { registry } from "../src/config/metrics.js";
import {
  MAX_BUNDLE_COURSES,
  MAX_BUNDLE_PAGE,
  MAX_BUNDLE_PAGE_SIZE,
  MAX_BUNDLE_TITLE_LENGTH,
} from "../src/validators/courseBundleValidators.js";

const BASE = "/api/course-bundles";
const MISSING_ID = "64b7f0c2a1b2c3d4e5f60718";

const tokenFor = (user) =>
  jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const bundleMetric = async (operation, outcome) => {
  const metric = await registry.getSingleMetric("course_bundle_requests_total").get();
  const sample = metric.values.find(
    (value) => value.labels.operation === operation && value.labels.outcome === outcome
  );
  return sample ? sample.value : 0;
};

describe("Course bundle API contract (#697)", () => {
  let replSet;
  let owner;
  let otherEducator;
  let student;
  let admin;
  let ownerToken;
  let otherToken;
  let studentToken;
  let adminToken;
  let ownedCourses;
  let foreignCourse;

  const validPayload = (overrides = {}) => ({
    title: "Seerah Essentials",
    description: "Two foundational seerah courses",
    courses: ownedCourses.map((course) => String(course._id)),
    price: 120,
    ...overrides,
  });

  const seedBundle = (overrides = {}) =>
    CourseBundle.create({
      title: "Owner bundle",
      description: "Bundle owned by the first educator",
      courses: ownedCourses.map((course) => course._id),
      price: 120,
      originalPrice: 150,
      discountPercentage: 20,
      createdBy: owner._id,
      ...overrides,
    });

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    await mongoose.connect(replSet.getUri());
    await CourseBundle.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  beforeEach(async () => {
    await Promise.all([CourseBundle.deleteMany({}), Course.deleteMany({}), User.deleteMany({})]);

    [owner, otherEducator, student, admin] = await User.create([
      { name: "Owner", email: "owner@example.com", password: "x".repeat(12), role: "mentor", verifiedEducator: true, isVerified: true },
      { name: "Other", email: "other@example.com", password: "x".repeat(12), role: "mentor", verifiedEducator: true, isVerified: true },
      { name: "Student", email: "student@example.com", password: "x".repeat(12), role: "student", isVerified: true },
      { name: "Admin", email: "admin@example.com", password: "x".repeat(12), role: "admin", isVerified: true },
    ]);
    [ownerToken, otherToken, studentToken, adminToken] = [owner, otherEducator, student, admin].map(tokenFor);

    ownedCourses = await Course.create([
      { title: "Seerah I", description: "Makkah period", category: "Seerah", price: 70, createdBy: owner._id },
      { title: "Seerah II", description: "Madinah period", category: "Seerah", price: 80, createdBy: owner._id },
    ]);
    foreignCourse = await Course.create({
      title: "Fiqh of Salah",
      description: "Another educator's course",
      category: "Fiqh",
      price: 50,
      createdBy: otherEducator._id,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("malformed ids", () => {
    it.each([
      ["get", `${BASE}/not-an-id`],
      ["get", `${BASE}/course/123`],
      ["get", "/api/courses/123/bundles"],
      ["put", `${BASE}/not-an-id`],
      ["delete", `${BASE}/not-an-id`],
      ["post", `${BASE}/not-an-id/purchase`],
    ])("%s %s is rejected with 400 before reaching the service", async (method, url) => {
      const spies = ["getBundleById", "getBundlesByCourse", "updateBundle", "deleteBundle", "purchaseBundle"]
        .map((name) => jest.spyOn(courseBundleService, name));

      const res = await request(app)[method](url).set(auth(ownerToken)).send(method === "put" ? { title: "x" } : undefined);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    });

    it("rejects malformed course ids inside the payload", async () => {
      const res = await request(app)
        .post(BASE)
        .set(auth(ownerToken))
        .send(validPayload({ courses: ["abc", { $gt: "" }] }));

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: "courses", message: "Invalid value." }]);
    });
  });

  describe("payload bounds", () => {
    it("rejects bundles with more than the maximum number of courses", async () => {
      const courses = Array.from({ length: MAX_BUNDLE_COURSES + 1 }, () => String(new mongoose.Types.ObjectId()));
      const createSpy = jest.spyOn(courseBundleService, "createBundle");

      const res = await request(app).post(BASE).set(auth(ownerToken)).send(validPayload({ courses }));

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe("courses");
      expect(createSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["an oversized title", { title: "t".repeat(MAX_BUNDLE_TITLE_LENGTH + 1) }, "title"],
      ["duplicate courses", null, "courses"],
      ["a negative price", { price: -1 }, "price"],
      ["a price above the ceiling", { price: 1_000_001 }, "price"],
      ["a price with more than 7 decimals", { price: 1.123456789 }, "price"],
      ["a price array", { price: [10] }, "price"],
      ["an unsupported currency", { currency: "BTC" }, "currency"],
      ["a missing title", { title: undefined }, "title"],
    ])("rejects %s", async (_label, overrides, field) => {
      const payload = overrides
        ? validPayload(overrides)
        : validPayload({ courses: [String(ownedCourses[0]._id), String(ownedCourses[0]._id)] });

      const res = await request(app).post(BASE).set(auth(ownerToken)).send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.details.map((detail) => detail.field)).toContain(field);
    });

    it("requires at least one updatable field on update", async () => {
      const bundle = await seedBundle();
      const res = await request(app).put(`${BASE}/${bundle._id}`).set(auth(ownerToken)).send({});
      expect(res.status).toBe(400);
    });
  });

  describe("unknown and server-owned fields", () => {
    it("rejects server-owned fields on create without calling the service", async () => {
      const createSpy = jest.spyOn(courseBundleService, "createBundle");

      const res = await request(app)
        .post(BASE)
        .set(auth(ownerToken))
        .send(validPayload({ createdBy: String(otherEducator._id), discountPercentage: 99, isActive: false }));

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe("Request contains unknown or read-only fields");
      expect(res.body.error.details.map((detail) => detail.field).sort()).toEqual(
        ["createdBy", "discountPercentage", "isActive"]
      );
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("blocks ownership transfer through update", async () => {
      const bundle = await seedBundle();

      const res = await request(app)
        .put(`${BASE}/${bundle._id}`)
        .set(auth(ownerToken))
        .send({ createdBy: String(otherEducator._id) });

      expect(res.status).toBe(400);
      const stored = await CourseBundle.findById(bundle._id);
      expect(String(stored.createdBy)).toBe(String(owner._id));
    });

    it("rejects unknown list query parameters", async () => {
      const res = await request(app).get(`${BASE}?isActive=false`);
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe("isActive");
    });

    it("rejects a body on purchase", async () => {
      const bundle = await seedBundle();
      const res = await request(app)
        .post(`${BASE}/${bundle._id}/purchase`)
        .set(auth(studentToken))
        .send({ price: 0 });
      expect(res.status).toBe(400);
    });
  });

  describe("authorization", () => {
    it("requires authentication for mutations", async () => {
      const res = await request(app).post(BASE).send(validPayload());
      expect(res.status).toBe(401);
    });

    it("forbids students from creating bundles", async () => {
      const res = await request(app).post(BASE).set(auth(studentToken)).send(validPayload());
      expect(res.status).toBe(403);
      expect(await CourseBundle.countDocuments()).toBe(0);
    });

    it("creates a bundle owned by the caller and computes pricing server-side", async () => {
      const res = await request(app).post(BASE).set(auth(ownerToken)).send(validPayload());

      expect(res.status).toBe(201);
      expect(res.body.data.createdBy._id).toBe(String(owner._id));
      expect(res.body.data.originalPrice).toBe(150);
      expect(res.body.data.discountPercentage).toBe(20);
    });

    it("forbids educators from bundling courses they do not own", async () => {
      const res = await request(app)
        .post(BASE)
        .set(auth(ownerToken))
        .send(validPayload({ courses: [String(ownedCourses[0]._id), String(foreignCourse._id)] }));

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("lets admins bundle any course", async () => {
      const res = await request(app)
        .post(BASE)
        .set(auth(adminToken))
        .send(validPayload({ courses: [String(ownedCourses[0]._id), String(foreignCourse._id)] }));
      expect(res.status).toBe(201);
    });

    it("forbids non-owners from updating and records the denial", async () => {
      const bundle = await seedBundle();
      const before = await bundleMetric("update", "forbidden");

      const res = await request(app).put(`${BASE}/${bundle._id}`).set(auth(otherToken)).send({ price: 1 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect((await CourseBundle.findById(bundle._id)).price).toBe(120);
      expect(await bundleMetric("update", "forbidden")).toBe(before + 1);
    });

    it("forbids owners from swapping in courses they do not own", async () => {
      const bundle = await seedBundle();
      const res = await request(app)
        .put(`${BASE}/${bundle._id}`)
        .set(auth(ownerToken))
        .send({ courses: [String(foreignCourse._id)] });
      expect(res.status).toBe(403);
    });

    it("forbids non-owners from deleting", async () => {
      const bundle = await seedBundle();
      const res = await request(app).delete(`${BASE}/${bundle._id}`).set(auth(otherToken));
      expect(res.status).toBe(403);
      expect((await CourseBundle.findById(bundle._id)).isActive).toBe(true);
    });

    it("lets owners and admins update", async () => {
      const bundle = await seedBundle();

      const ownerRes = await request(app).put(`${BASE}/${bundle._id}`).set(auth(ownerToken)).send({ price: 75 });
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body.data.discountPercentage).toBe(50);

      const adminRes = await request(app).put(`${BASE}/${bundle._id}`).set(auth(adminToken)).send({ title: "Renamed" });
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data.title).toBe("Renamed");
    });
  });

  describe("pagination", () => {
    const seedMany = (count, createdAt = new Date("2026-01-01T00:00:00Z")) =>
      CourseBundle.insertMany(
        Array.from({ length: count }, (_, index) => ({
          title: `Bundle ${index}`,
          description: "Paged bundle",
          courses: [ownedCourses[0]._id],
          price: index,
          createdBy: owner._id,
          // Identical timestamps force the `_id` tiebreaker to keep pages stable.
          createdAt,
          updatedAt: createdAt,
        })),
        { timestamps: false }
      );

    it("applies the default page size and reports pagination metadata", async () => {
      await seedMany(25);

      const res = await request(app).get(BASE);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(20);
      expect(res.body.count).toBe(20);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 25, pages: 2 });
    });

    it("walks pages without duplicates or gaps", async () => {
      await seedMany(7);
      const seen = [];
      for (let page = 1; page <= 3; page += 1) {
        const res = await request(app).get(`${BASE}?limit=3&page=${page}`);
        expect(res.status).toBe(200);
        seen.push(...res.body.data.map((bundle) => bundle._id));
      }
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    });

    it("supports price sorting", async () => {
      await seedMany(3);
      const res = await request(app).get(`${BASE}?sort=-price&limit=3`);
      expect(res.body.data.map((bundle) => bundle.price)).toEqual([2, 1, 0]);
    });

    it.each([
      `limit=${MAX_BUNDLE_PAGE_SIZE + 1}`,
      "limit=0",
      "page=0",
      `page=${MAX_BUNDLE_PAGE + 1}`,
      "limit=abc",
      "sort=title",
      `search=${"s".repeat(101)}`,
      "courseId=123",
    ])("rejects out-of-bounds query %s", async (queryString) => {
      const res = await request(app).get(`${BASE}?${queryString}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("bounds the per-course listing on both mount points", async () => {
      await seedMany(4);
      const courseId = ownedCourses[0]._id;

      const viaBundles = await request(app).get(`${BASE}/course/${courseId}?limit=2`);
      const viaCourses = await request(app).get(`/api/courses/${courseId}/bundles?limit=2`);

      for (const res of [viaBundles, viaCourses]) {
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.pagination.total).toBe(4);
      }
      const tooLarge = await request(app).get(`/api/courses/${courseId}/bundles?limit=500`);
      expect(tooLarge.status).toBe(400);
    });
  });

  describe("not found", () => {
    it.each([
      ["get", ""],
      ["put", ""],
      ["delete", ""],
      ["post", "/purchase"],
    ])("%s returns 404 for an unknown bundle", async (method, suffix) => {
      const res = await request(app)[method](`${BASE}/${MISSING_ID}${suffix}`)
        .set(auth(adminToken))
        .send(method === "put" ? { title: "x" } : undefined);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("conflict and idempotency", () => {
    it("rejects updates to a deactivated bundle with 409", async () => {
      const bundle = await seedBundle({ isActive: false });
      const res = await request(app).put(`${BASE}/${bundle._id}`).set(auth(ownerToken)).send({ title: "Revive" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
    });

    it("treats a repeated delete as a successful no-op", async () => {
      const bundle = await seedBundle();
      const first = await request(app).delete(`${BASE}/${bundle._id}`).set(auth(ownerToken));
      const second = await request(app).delete(`${BASE}/${bundle._id}`).set(auth(ownerToken));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect((await CourseBundle.findById(bundle._id)).isActive).toBe(false);
    });

    it("maps concurrent modification errors to 409", async () => {
      const bundle = await seedBundle();
      const versionError = Object.assign(new Error("No matching document found for id"), { name: "VersionError" });
      jest.spyOn(courseBundleService, "updateBundle").mockRejectedValue(versionError);

      const res = await request(app).put(`${BASE}/${bundle._id}`).set(auth(ownerToken)).send({ price: 10 });

      expect(res.status).toBe(409);
      expect(res.body.error.message).not.toMatch(/No matching document/);
    });

    it("keeps repeat purchases idempotent", async () => {
      const bundle = await seedBundle();
      await request(app).post(`${BASE}/${bundle._id}/purchase`).set(auth(studentToken)).expect(200);
      const repeat = await request(app).post(`${BASE}/${bundle._id}/purchase`).set(auth(studentToken));

      expect(repeat.status).toBe(200);
      expect(repeat.body.newlyEnrolledCount).toBe(0);
      expect((await User.findById(student._id)).purchasedCourses).toHaveLength(2);
    });

    it("refuses to purchase a deactivated bundle", async () => {
      const bundle = await seedBundle({ isActive: false });
      const res = await request(app).post(`${BASE}/${bundle._id}/purchase`).set(auth(studentToken));
      expect(res.status).toBe(404);
    });
  });

  describe("dependency and unexpected failures", () => {
    it("maps database outages to 503 without leaking driver details", async () => {
      const outage = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:27017"), {
        name: "MongoServerSelectionError",
      });
      jest.spyOn(courseBundleService, "getBundles").mockRejectedValue(outage);
      const before = await bundleMetric("list", "dependency_failure");

      const res = await request(app).get(BASE);

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("DATABASE_ERROR");
      expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|stack/);
      expect(await bundleMetric("list", "dependency_failure")).toBe(before + 1);
    });

    it("maps unexpected failures to a generic 500", async () => {
      jest
        .spyOn(courseBundleService, "getBundleById")
        .mockRejectedValue(new Error("db.coursebundles index corrupted at shard-2"));

      const res = await request(app).get(`${BASE}/${MISSING_ID}`);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(res.body)).not.toMatch(/corrupted|shard-2|stack/);
    });
  });
});
