import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import Course from "../src/models/Course.js";
import Space from "../src/models/Space.js";
import AuditLog from "../src/models/AuditLog.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import {
  authorizeOwnership,
  authorizeReviewOwnership,
} from "../src/middlewares/authorize.js";

// Mirrors test/authRoles.test.js: a mini express app + MongoMemoryServer with an
// injected req.user, mounting a single guard followed by a stub handler that
// returns 200 when the guard calls next(). Denials flow through the global
// errorHandler and surface as 403/404.

// Build an app that injects `user`, runs `guard`, and returns 200 if it passes.
const buildApp = (user, method, path, guard) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app[method](path, guard, (req, res) =>
    res.status(200).json({
      ok: true,
      resourceId: req.resource?._id,
      reviewId: req.review?._id,
    })
  );
  app.use(errorHandler);
  return app;
};

// Poll for a fire-and-forget audit row (recordAudit schedules the write async).
const waitForAudit = async (query, timeout = 3000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const row = await AuditLog.findOne(query);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
};

describe("Resource-Ownership Authorization Layer", () => {
  let mongoServer;
  let ownerMentor, otherMentor, studentUser, adminUser, reviewerUser;
  let book, course, space, bookReviewId, courseReviewId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Book.deleteMany({});
    await Course.deleteMany({});
    await Space.deleteMany({});
    // AuditLog is append-only (model hooks block deleteMany); clear via the
    // raw collection so each test starts with a clean audit trail.
    await mongoose.connection.collection("auditlogs").deleteMany({});

    ownerMentor = await User.create({
      name: "Owner Mentor",
      email: "owner_mentor@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
    });
    otherMentor = await User.create({
      name: "Other Mentor",
      email: "other_mentor@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
    });
    studentUser = await User.create({
      name: "Student",
      email: "student@example.com",
      password: "Qx7#vLmp92Zt",
      role: "student",
    });
    adminUser = await User.create({
      name: "Admin",
      email: "admin@example.com",
      password: "Qx7#vLmp92Zt",
      role: "admin",
    });
    reviewerUser = await User.create({
      name: "Reviewer",
      email: "reviewer@example.com",
      password: "Qx7#vLmp92Zt",
      role: "student",
    });

    book = await Book.create({
      title: "Owned Book",
      description: "Desc",
      category: "Tech",
      price: 10,
      author: ownerMentor._id,
      image: "https://example.com/thumb.jpg",
      fileUrl: "https://example.com/file.pdf",
      reviews: [{ user: reviewerUser._id, comment: "Nice", rating: 5 }],
    });
    bookReviewId = book.reviews[0]._id;

    course = await Course.create({
      title: "Owned Course",
      description: "Desc",
      category: "Tech",
      price: 10,
      createdBy: ownerMentor._id,
      reviews: [{ user: reviewerUser._id, comment: "Great", rating: 4 }],
    });
    courseReviewId = course.reviews[0]._id;

    space = await Space.create({
      title: "Owned Space",
      description: "Desc",
      category: "Tech",
      host: ownerMentor._id,
      price: 0,
      eventDate: new Date(),
      eventTime: "10:00",
      duration: 60,
    });
  });

  const missingId = () => new mongoose.Types.ObjectId();

  // ── Top-level resource ownership (Book / Course / Space) ───────────────────
  describe.each([
    {
      label: "Book DELETE",
      method: "delete",
      path: "/books/:id",
      guard: () =>
        authorizeOwnership({ model: Book, ownerField: "author", resourceType: "Book" }),
      url: () => `/books/${book._id}`,
      missingUrl: () => `/books/${missingId()}`,
      targetId: () => String(book._id),
      resourceType: "Book",
    },
    {
      label: "Course PUT",
      method: "put",
      path: "/courses/:id",
      guard: () =>
        authorizeOwnership({ model: Course, ownerField: "createdBy", resourceType: "Course" }),
      url: () => `/courses/${course._id}`,
      missingUrl: () => `/courses/${missingId()}`,
      targetId: () => String(course._id),
      resourceType: "Course",
    },
    {
      label: "Space PUT (update)",
      method: "put",
      path: "/spaces/update/:id",
      guard: () =>
        authorizeOwnership({ model: Space, ownerField: "host", resourceType: "Space" }),
      url: () => `/spaces/update/${space._id}`,
      missingUrl: () => `/spaces/update/${missingId()}`,
      targetId: () => String(space._id),
      resourceType: "Space",
    },
    {
      label: "Space DELETE",
      method: "delete",
      path: "/spaces/:id",
      guard: () =>
        authorizeOwnership({ model: Space, ownerField: "host", resourceType: "Space" }),
      url: () => `/spaces/${space._id}`,
      missingUrl: () => `/spaces/${missingId()}`,
      targetId: () => String(space._id),
      resourceType: "Space",
    },
  ])("$label", ({ method, path, guard, url, missingUrl, targetId, resourceType }) => {
    it("allows the resource owner (2xx)", async () => {
      const app = buildApp(ownerMentor, method, path, guard());
      const res = await request(app)[method](url());
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("allows an admin (2xx)", async () => {
      const app = buildApp(adminUser, method, path, guard());
      const res = await request(app)[method](url());
      expect(res.status).toBe(200);
    });

    it("rejects a non-owner mentor (403) and audits the denial", async () => {
      const app = buildApp(otherMentor, method, path, guard());
      const res = await request(app)[method](url());
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);

      const row = await waitForAudit({
        action: "authz.ownership.denied",
        actor: otherMentor._id,
        targetId: targetId(),
      });
      expect(row).not.toBeNull();
      expect(row.status).toBe("failure");
      expect(row.targetType).toBe(resourceType);
      expect(String(row.actor)).toBe(String(otherMentor._id));
    });

    it("rejects a non-owner student (403)", async () => {
      const app = buildApp(studentUser, method, path, guard());
      const res = await request(app)[method](url());
      expect(res.status).toBe(403);
    });

    it("returns 404 for a non-existent resource", async () => {
      const app = buildApp(ownerMentor, method, path, guard());
      const res = await request(app)[method](missingUrl());
      expect(res.status).toBe(404);
    });
  });

  // ── Review subdocument ownership (Book / Course, id-scoped) ────────────────
  describe.each([
    {
      label: "Book review (id-scoped)",
      method: "put",
      path: "/books/:id/reviews/:reviewId",
      guard: () => authorizeReviewOwnership({ model: Book }),
      url: () => `/books/${book._id}/reviews/${bookReviewId}`,
      missingUrl: () => `/books/${missingId()}/reviews/${bookReviewId}`,
      missingReviewUrl: () => `/books/${book._id}/reviews/${missingId()}`,
      targetId: () => String(bookReviewId),
    },
    {
      label: "Book review DELETE (id-scoped)",
      method: "delete",
      path: "/books/:id/reviews/:reviewId",
      guard: () => authorizeReviewOwnership({ model: Book }),
      url: () => `/books/${book._id}/reviews/${bookReviewId}`,
      missingUrl: () => `/books/${missingId()}/reviews/${bookReviewId}`,
      missingReviewUrl: () => `/books/${book._id}/reviews/${missingId()}`,
      targetId: () => String(bookReviewId),
    },
    {
      label: "Course review (id-scoped)",
      method: "put",
      path: "/courses/:id/reviews/:reviewId",
      guard: () => authorizeReviewOwnership({ model: Course }),
      url: () => `/courses/${course._id}/reviews/${courseReviewId}`,
      missingUrl: () => `/courses/${missingId()}/reviews/${courseReviewId}`,
      missingReviewUrl: () => `/courses/${course._id}/reviews/${missingId()}`,
      targetId: () => String(courseReviewId),
    },
    {
      label: "Course review DELETE (id-scoped)",
      method: "delete",
      path: "/courses/:id/reviews/:reviewId",
      guard: () => authorizeReviewOwnership({ model: Course }),
      url: () => `/courses/${course._id}/reviews/${courseReviewId}`,
      missingUrl: () => `/courses/${missingId()}/reviews/${courseReviewId}`,
      missingReviewUrl: () => `/courses/${course._id}/reviews/${missingId()}`,
      targetId: () => String(courseReviewId),
    },
  ])("$label", ({ method, path, guard, url, missingUrl, missingReviewUrl, targetId }) => {
    it("allows the review owner (2xx)", async () => {
      const app = buildApp(reviewerUser, method, path, guard());
      const res = await request(app)[method](url());
      expect(res.status).toBe(200);
    });

    it("allows an admin (2xx)", async () => {
      const app = buildApp(adminUser, method, path, guard());
      const res = await request(app)[method](url());
      expect(res.status).toBe(200);
    });

    it("rejects a non-owner mentor (403) and audits the denial", async () => {
      const app = buildApp(otherMentor, method, path, guard());
      const res = await request(app)[method](url());
      expect(res.status).toBe(403);

      const row = await waitForAudit({
        action: "authz.ownership.denied",
        actor: otherMentor._id,
        targetId: targetId(),
      });
      expect(row).not.toBeNull();
      expect(row.status).toBe("failure");
      expect(row.targetType).toBe("Review");
    });

    it("rejects a non-owner student (403)", async () => {
      const app = buildApp(studentUser, method, path, guard());
      const res = await request(app)[method](url());
      expect(res.status).toBe(403);
    });

    it("returns 404 for a non-existent parent item", async () => {
      const app = buildApp(reviewerUser, method, path, guard());
      const res = await request(app)[method](missingUrl());
      expect(res.status).toBe(404);
    });

    it("returns 404 for a non-existent review id", async () => {
      const app = buildApp(reviewerUser, method, path, guard());
      const res = await request(app)[method](missingReviewUrl());
      expect(res.status).toBe(404);
    });
  });

  // ── Review subdocument ownership (self-scoped: no :reviewId) ───────────────
  describe("Review (self-scoped) ownership", () => {
    it("allows the caller to act on their own review (2xx)", async () => {
      const app = buildApp(reviewerUser, "put", "/books/:id/reviews", authorizeReviewOwnership({ model: Book }));
      const res = await request(app).put(`/books/${book._id}/reviews`);
      expect(res.status).toBe(200);
      expect(String(res.body.reviewId)).toBe(String(bookReviewId));
    });

    it("returns 404 when the caller has no review of their own", async () => {
      const app = buildApp(otherMentor, "delete", "/courses/:id/reviews", authorizeReviewOwnership({ model: Course }));
      const res = await request(app).delete(`/courses/${course._id}/reviews`);
      expect(res.status).toBe(404);
    });
  });
});
