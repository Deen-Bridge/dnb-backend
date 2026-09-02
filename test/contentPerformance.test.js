import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../app.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import Book from "../src/models/Book.js";
import CourseProgress from "../src/models/CourseProgress.js";
import ReadingProgress from "../src/models/ReadingProgress.js";
import {
  interactionRate,
  completionRate,
  avgTimeSpentSeconds,
  avgPercentComplete,
  engagementScore,
} from "../src/utils/analytics/engagementCalculator.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";

// View increments are fire-and-forget by design, so a test must wait for the
// metric write to land before asserting on the database.
const waitFor = async (fn, timeoutMs = 2000, intervalMs = 25) => {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

describe("Engagement calculator utilities (#244)", () => {
  it("computes interaction rate as reviews per view, capped at 100", () => {
    expect(interactionRate(2, 10)).toBe(20);
    expect(interactionRate(5, 2)).toBe(100); // capped
    expect(interactionRate(3, 0)).toBe(0); // no views
    expect(interactionRate(0, 10)).toBe(0); // no reviews
  });

  it("computes completion rate from completions over enrollments", () => {
    expect(completionRate(1, 2)).toBe(50);
    expect(completionRate(3, 10)).toBe(30);
    expect(completionRate(2, 0)).toBe(0);
  });

  it("averages time spent across progress records", () => {
    expect(
      avgTimeSpentSeconds([
        { lastPositionSeconds: 100 },
        { lastPositionSeconds: 300 },
      ])
    ).toBe(200);
    expect(avgTimeSpentSeconds([])).toBe(0);
  });

  it("averages completion percentage", () => {
    expect(
      avgPercentComplete([{ percentComplete: 100 }, { percentComplete: 50 }])
    ).toBe(75);
  });

  it("blends completion, interaction and depth into a 0-100 score", () => {
    expect(
      engagementScore({
        completionRate: 100,
        interactionRate: 100,
        avgPercentComplete: 100,
      })
    ).toBe(100);
    expect(
      engagementScore({
        completionRate: 50,
        interactionRate: 20,
        avgPercentComplete: 50,
      })
    ).toBe(41); // 0.4*50 + 0.3*20 + 0.3*50 = 41
    expect(engagementScore({})).toBe(0);
  });
});

describe("Content performance analytics (#244)", () => {
  jest.setTimeout(30000);
  let mongoServer;
  let author;
  let authorToken;
  let student;
  let studentToken;
  let course;
  let book;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    const a = await seedUserAndLogin(app, {
      name: "Perf Author",
      email: "perf-author@example.com",
      role: "mentor",
      verifiedEducator: true,
    });
    author = a.user;
    authorToken = a.token;

    const s = await seedUserAndLogin(app, {
      name: "Perf Student",
      email: "perf-student@example.com",
    });
    student = s.user;
    studentToken = s.token;
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    // Seeded users are kept so their login tokens stay valid.
    await Promise.all([
      Course.deleteMany({}),
      Book.deleteMany({}),
      CourseProgress.deleteMany({}),
      ReadingProgress.deleteMany({}),
    ]);

    course = await Course.create({
      title: "Fiqh of Purification",
      description: "Course on ritual purity and prayer.",
      category: "Fiqh",
      createdBy: author._id,
      status: "published",
      views: 0,
      numReviews: 4,
      enrolledUsers: [student._id, author._id],
      sections: [
        {
          title: "Purification",
          order: 1,
          lessons: [
            { title: "Wudu", order: 1, durationSeconds: 300 },
            { title: "Ghusl", order: 2, durationSeconds: 300 },
          ],
        },
      ],
    });

    book = await Book.create({
      title: "Fortress of the Muslim",
      author: author._id,
      category: "Duas",
      price: 0,
      description: "Duas and adhkar.",
      image: "https://example.com/cover.jpg",
      fileUrl: "https://example.com/book.pdf",
      readCount: 10,
      numReviews: 2,
    });

    // One learner completed the course, one is halfway.
    await CourseProgress.create({
      user: student._id,
      course: course._id,
      percentComplete: 100,
      completedAt: new Date(),
      lastPositionSeconds: 600,
    });
    await CourseProgress.create({
      user: author._id,
      course: course._id,
      percentComplete: 50,
      lastPositionSeconds: 300,
    });

    // One reader finished the book, one is at 25%.
    await ReadingProgress.create({
      user: student._id,
      book: book._id,
      percentage: 100,
      page: 100,
      totalPages: 100,
    });
    await ReadingProgress.create({
      user: author._id,
      book: book._id,
      percentage: 25,
      page: 25,
      totalPages: 100,
    });
  });

  it("requires authentication for the analytics endpoints", async () => {
    const res = await request(app).get("/api/analytics/content-performance");
    expect(res.status).toBe(401);
  });

  it("increments course views when a course detail page is fetched", async () => {
    const res = await request(app).get(`/api/courses/${course._id}`);
    expect(res.status).toBe(200);

    await waitFor(async () => (await Course.findById(course._id)).views === 1);
  });

  it("increments book read counts when a book detail page is fetched", async () => {
    const res = await request(app).get(`/api/books/${book._id}`);
    expect(res.status).toBe(200);

    await waitFor(async () => (await Book.findById(book._id)).readCount === 11);
  });

  it("returns comparative analytics across courses and books", async () => {
    // Fetch both detail pages first so the view counters reflect real usage.
    await request(app).get(`/api/courses/${course._id}`);
    await request(app).get(`/api/books/${book._id}`);

    const res = await request(app)
      .get("/api/analytics/content-performance")
      .set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.totalContent).toBe(2);
    expect(res.body.summary.totalViews).toBe(12); // 1 course view + 11 book reads
    expect(res.body.content).toHaveLength(2);

    const courseRow = res.body.content.find((c) => c.type === "course");
    expect(courseRow).toMatchObject({
      title: "Fiqh of Purification",
      views: 1,
      reviews: 4,
      enrollments: 2,
      completions: 1,
      completionRate: 50,
    });
    expect(courseRow.interactionRate).toBe(100); // 4 reviews / 1 view, capped
    expect(courseRow.avgTimeSpentSeconds).toBe(450);
    expect(courseRow.avgPercentComplete).toBe(75);
    expect(typeof courseRow.engagementScore).toBe("number");

    const bookRow = res.body.content.find((c) => c.type === "book");
    expect(bookRow).toMatchObject({
      title: "Fortress of the Muslim",
      views: 11,
      reviews: 2,
    });
    expect(bookRow.interactionRate).toBeCloseTo(18.18, 1);
    expect(bookRow.avgPercentComplete).toBe(62.5);
  });

  it("returns metrics for a single course", async () => {
    const res = await request(app)
      .get(`/api/analytics/content-performance/course/${course._id}`)
      .set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.metrics.type).toBe("course");
    expect(res.body.metrics.completionRate).toBe(50);
    expect(res.body.metrics.enrollments).toBe(2);
  });

  it("returns metrics for a single book", async () => {
    const res = await request(app)
      .get(`/api/analytics/content-performance/book/${book._id}`)
      .set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.metrics.type).toBe("book");
    expect(res.body.metrics.views).toBe(10);
    expect(res.body.metrics.reviews).toBe(2);
  });

  it("rejects an invalid content type", async () => {
    const res = await request(app)
      .get(`/api/analytics/content-performance/reel/${course._id}`)
      .set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(400);
  });

  it("returns 404 for a missing course", async () => {
    const missing = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/analytics/content-performance/course/${missing}`)
      .set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(404);
  });
});
