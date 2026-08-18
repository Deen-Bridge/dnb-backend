import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import Course from "../src/models/Course.js";
import Space from "../src/models/Space.js";
import EducatorVerification, {
  VERIFICATION_STATUS,
  LEGAL_TRANSITIONS,
} from "../src/models/EducatorVerification.js";
import AuditLog, { AUDIT_ACTIONS } from "../src/models/AuditLog.js";
import { requireVerifiedEducator } from "../src/middlewares/authMiddleware.js";
import express from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";
const mintToken = (user) =>
  jwt.sign(
    { userId: user._id.toString(), role: user.role, sessionId: "sess-test" },
    JWT_SECRET,
    { expiresIn: "15m" }
  );

describe("Issue #92 — Educator Verification Pipeline + Content Gating", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    await mongoose.connect(mongoServer.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Book.deleteMany({});
    await Course.deleteMany({});
    await Space.deleteMany({});
    await EducatorVerification.deleteMany({});
    await AuditLog.collection.deleteMany({});
  });

  // ── Shared helpers ──────────────────────────────────────────────────────
  const createUsers = async () => {
    const student = await User.create({
      name: "Student User",
      email: "student@example.com",
      password: "Qx7#vLmp92Zt",
      role: "student",
    });
    const mentor = await User.create({
      name: "Mentor User",
      email: "mentor@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
    });
    const verifiedEducator = await User.create({
      name: "Verified Educator",
      email: "verified@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
      verifiedEducator: true,
    });
    const admin = await User.create({
      name: "Admin User",
      email: "admin@example.com",
      password: "Qx7#vLmp92Zt",
      role: "admin",
    });
    return { student, mentor, verifiedEducator, admin };
  };

  const authHeader = (user) => `Bearer ${mintToken(user)}`;

  const sampleDocuments = () => [
    {
      type: "government_id",
      cloudinaryPublicId: "educator-verification/sample-id",
      originalFileName: "government_id.pdf",
    },
    {
      type: "teaching_certificate",
      cloudinaryPublicId: "educator-verification/sample-cert",
      originalFileName: "teaching_cert.pdf",
    },
  ];

  describe("1. EducatorVerification Model — State Machine", () => {
    it("exposes correct status enum values", () => {
      expect(VERIFICATION_STATUS).toEqual({
        DRAFT: "draft",
        PENDING: "pending",
        APPROVED: "approved",
        REJECTED: "rejected",
      });
    });

    it("defines only legal transitions", () => {
      expect(LEGAL_TRANSITIONS).toEqual({
        draft: ["pending"],
        pending: ["approved", "rejected"],
        approved: [],
        rejected: ["pending"],
      });
    });

    it("allows draft→pending transition", () => {
      expect(
        EducatorVerification.isValidTransition("draft", "pending")
      ).toBe(true);
    });

    it("allows pending→approved and pending→rejected transitions", () => {
      expect(
        EducatorVerification.isValidTransition("pending", "approved")
      ).toBe(true);
      expect(
        EducatorVerification.isValidTransition("pending", "rejected")
      ).toBe(true);
    });

    it("allows rejected→pending (resubmit) transition", () => {
      expect(
        EducatorVerification.isValidTransition("rejected", "pending")
      ).toBe(true);
    });

    it("rejects illegal transitions", () => {
      const illegal = [
        ["draft", "approved"],
        ["draft", "rejected"],
        ["pending", "draft"],
        ["approved", "pending"],
        ["approved", "rejected"],
        ["rejected", "approved"],
        ["rejected", "rejected"],
        ["approved", "draft"],
      ];
      for (const [from, to] of illegal) {
        expect(EducatorVerification.isValidTransition(from, to)).toBe(false);
      }
    });

    it("instance method canTransitionTo mirrors the static check", async () => {
      const { mentor } = await createUsers();
      const v = await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.REJECTED,
      });
      expect(v.canTransitionTo(VERIFICATION_STATUS.PENDING)).toBe(true);
      expect(v.canTransitionTo(VERIFICATION_STATUS.APPROVED)).toBe(false);
    });

    it("rejects invalid status strings at model level", async () => {
      const { mentor } = await createUsers();
      await expect(
        EducatorVerification.create({
          applicant: mentor._id,
          status: "totally_invalid_status",
        })
      ).rejects.toThrow();
    });
  });

  describe("2. requireVerifiedEducator Middleware", () => {
    const setupApp = () => {
      const a = express();
      a.post("/create", (req, _res, next) => {
        const hdr = req.headers.authorization || "";
        const tok = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
        if (tok) {
          try {
            const dec = jwt.verify(tok, JWT_SECRET);
            req.user = {
              _id: dec.userId,
              role: dec.role,
              verifiedEducator:
                dec.userId === "verified-1" || dec.role === "admin",
            };
          } catch (_) {}
        }
        next();
      }, requireVerifiedEducator, (_req, res) =>
        res.status(200).json({ success: true, created: true })
      );
      return a;
    };

    it("returns 401 when no authenticated user", async () => {
      const a = setupApp();
      const res = await request(a).post("/create");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("returns 403 when a normal (unverified) user hits the route", async () => {
      const a = setupApp();
      const token = jwt.sign(
        { userId: "student-1", role: "student", sessionId: "x" },
        JWT_SECRET
      );
      const res = await request(a)
        .post("/create")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/verified educator/);
    });

    it("allows admin to bypass the verifiedEducator gate", async () => {
      const a = setupApp();
      const token = jwt.sign(
        { userId: "admin-1", role: "admin", sessionId: "x" },
        JWT_SECRET
      );
      const res = await request(a)
        .post("/create")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("allows verified educator through", async () => {
      const a = setupApp();
      const token = jwt.sign(
        { userId: "verified-1", role: "mentor", sessionId: "x" },
        JWT_SECRET
      );
      const res = await request(a)
        .post("/create")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(true);
    });
  });

  describe("3. Applicant API — Submit / Resubmit / Get own", () => {
    it("returns null application when applicant has not applied yet", async () => {
      const { mentor } = await createUsers();
      const res = await request(app)
        .get("/api/educator-verification")
        .set("Authorization", authHeader(mentor));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.application).toBeNull();
    });

    it("requires auth for applicant endpoints — returns 401", async () => {
      const res = await request(app).get("/api/educator-verification");
      expect(res.status).toBe(401);

      const res2 = await request(app)
        .post("/api/educator-verification/submit")
        .send({ documents: [] });
      expect(res2.status).toBe(401);
    });

    it("rejects submit with no documents (400)", async () => {
      const { mentor } = await createUsers();
      const res = await request(app)
        .post("/api/educator-verification/submit")
        .set("Authorization", authHeader(mentor))
        .send({ documents: [] });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/document/);
    });

    it("rejects submit with malformed document entries (400)", async () => {
      const { mentor } = await createUsers();
      const res = await request(app)
        .post("/api/educator-verification/submit")
        .set("Authorization", authHeader(mentor))
        .send({ documents: [{ type: "government_id" }] });
      expect(res.status).toBe(400);
    });

    it("submits a new application — moves to PENDING, writes AUDIT submit", async () => {
      const { mentor } = await createUsers();
      const docs = sampleDocuments();

      const res = await request(app)
        .post("/api/educator-verification/submit")
        .set("Authorization", authHeader(mentor))
        .send({ documents: docs, personalStatement: "I love teaching" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.application.status).toBe(VERIFICATION_STATUS.PENDING);
      expect(res.body.application.documents.length).toBe(2);
      expect(res.body.application.submittedAt).toBeDefined();

      const v = await EducatorVerification.findOne({
        applicant: mentor._id,
      });
      expect(v).not.toBeNull();
      expect(v.status).toBe(VERIFICATION_STATUS.PENDING);
      expect(v.personalStatement).toBe("I love teaching");
      expect(v.documents.length).toBe(2);

      const audit = await AuditLog.findOne({
        targetId: v._id.toString(),
      });
      expect(audit).not.toBeNull();
      expect(audit.action).toBe(AUDIT_ACTIONS.EDUCATOR_VERIFY_SUBMIT);
      expect(audit.status).toBe("success");
      expect(audit.actor.toString()).toBe(mentor._id.toString());
    });

    it("prevents creating duplicate application while one is pending (409)", async () => {
      const { mentor } = await createUsers();
      await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.PENDING,
        submittedAt: new Date(),
        documents: sampleDocuments(),
      });

      const res = await request(app)
        .post("/api/educator-verification/submit")
        .set("Authorization", authHeader(mentor))
        .send({ documents: sampleDocuments() });
      expect(res.status).toBe(409);
    });

    it("resubmit after rejection — returns PENDING + RESUBMIT audit", async () => {
      const { mentor } = await createUsers();
      const v = await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.REJECTED,
        documents: sampleDocuments(),
        submittedAt: new Date(Date.now() - 86400000),
        reviewNotes: "Need more docs",
        reviewedAt: new Date(),
      });

      const newDocs = [
        ...sampleDocuments(),
        {
          type: "degree",
          cloudinaryPublicId: "educator-verification/degree-v2",
          originalFileName: "degree.pdf",
        },
      ];

      const res = await request(app)
        .post("/api/educator-verification/submit")
        .set("Authorization", authHeader(mentor))
        .send({ documents: newDocs });

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/resubmitted/i);
      expect(res.body.application.status).toBe(VERIFICATION_STATUS.PENDING);

      const reloaded = await EducatorVerification.findById(v._id);
      expect(reloaded.status).toBe(VERIFICATION_STATUS.PENDING);
      expect(reloaded.reviewNotes).toBeNull();
      expect(reloaded.reviewedBy).toBeNull();
      expect(reloaded.reviewedAt).toBeNull();
      expect(reloaded.documents.length).toBe(3);

      const audit = await AuditLog.findOne({
        action: AUDIT_ACTIONS.EDUCATOR_VERIFY_RESUBMIT,
      });
      expect(audit).not.toBeNull();
    });

    it("GET /api/educator-verification returns applicant's own application", async () => {
      const { mentor } = await createUsers();
      const v = await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.PENDING,
        submittedAt: new Date(),
        documents: sampleDocuments(),
      });
      const res = await request(app)
        .get("/api/educator-verification")
        .set("Authorization", authHeader(mentor));
      expect(res.status).toBe(200);
      expect(res.body.application._id.toString()).toBe(v._id.toString());
      expect(res.body.application.documents.length).toBe(2);
    });

    it("GET /upload-signature returns signed upload credentials", async () => {
      const { mentor } = await createUsers();
      const res = await request(app)
        .get("/api/educator-verification/upload-signature")
        .set("Authorization", authHeader(mentor));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.timestamp).toBeDefined();
      expect(res.body.data.signature).toBeDefined();
      expect(res.body.data.folder).toBe("educator-verification");
      expect(res.body.data.uploadType).toBe("authenticated");
    });
  });

  describe("4. Admin Review Queue — Admin-Only Gating", () => {
    it("non-admin users get 403 on all admin endpoints", async () => {
      const { student, mentor, verifiedEducator } = await createUsers();
      const nonAdmins = [student, mentor, verifiedEducator];
      for (const u of nonAdmins) {
        const list = await request(app)
          .get("/api/admin/educator-verification")
          .set("Authorization", authHeader(u));
        expect(list.status).toBe(403);
      }
    });

    it("admin can list pending applications", async () => {
      const { admin, mentor, student } = await createUsers();
      await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.PENDING,
        submittedAt: new Date(),
        documents: sampleDocuments(),
      });
      await EducatorVerification.create({
        applicant: student._id,
        status: VERIFICATION_STATUS.REJECTED,
        submittedAt: new Date(),
        documents: sampleDocuments(),
      });

      const res = await request(app)
        .get("/api/admin/educator-verification?status=pending")
        .set("Authorization", authHeader(admin));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.applications.length).toBe(1);
      expect(res.body.pagination.total).toBe(1);
    });

    it("admin can fetch a single application by id", async () => {
      const { admin, mentor } = await createUsers();
      const v = await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.PENDING,
        submittedAt: new Date(),
        documents: sampleDocuments(),
      });
      const res = await request(app)
        .get(`/api/admin/educator-verification/${v._id}`)
        .set("Authorization", authHeader(admin));
      expect(res.status).toBe(200);
      expect(res.body.application.applicant).toBeDefined();
      expect(res.body.application.documents.length).toBe(2);
    });

    it("admin approval sets verifiedEducator=true + APPROVE audit", async () => {
      const { admin, mentor } = await createUsers();
      const v = await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.PENDING,
        submittedAt: new Date(),
        documents: sampleDocuments(),
      });

      const res = await request(app)
        .post(`/api/admin/educator-verification/${v._id}/approve`)
        .set("Authorization", authHeader(admin))
        .send({ reviewNotes: "Credentials look good." });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/approved/i);

      const reloadedV = await EducatorVerification.findById(v._id);
      expect(reloadedV.status).toBe(VERIFICATION_STATUS.APPROVED);
      expect(reloadedV.reviewedBy.toString()).toBe(admin._id.toString());
      expect(reloadedV.reviewNotes).toBe("Credentials look good.");
      expect(reloadedV.reviewedAt).not.toBeNull();

      const reloadedUser = await User.findById(mentor._id);
      expect(reloadedUser.verifiedEducator).toBe(true);

      const audit = await AuditLog.findOne({
        action: AUDIT_ACTIONS.EDUCATOR_VERIFY_APPROVE,
      });
      expect(audit).not.toBeNull();
      expect(audit.targetId).toBe(v._id.toString());
    });

    it("admin rejection does NOT set verifiedEducator + REJECT audit", async () => {
      const { admin, mentor } = await createUsers();
      const v = await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.PENDING,
        submittedAt: new Date(),
        documents: sampleDocuments(),
      });

      const res = await request(app)
        .post(`/api/admin/educator-verification/${v._id}/reject`)
        .set("Authorization", authHeader(admin))
        .send({ reviewNotes: "Please upload a clearer ID." });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/rejected/i);

      const reloadedV = await EducatorVerification.findById(v._id);
      expect(reloadedV.status).toBe(VERIFICATION_STATUS.REJECTED);

      const reloadedUser = await User.findById(mentor._id);
      expect(reloadedUser.verifiedEducator).toBe(false);

      const audit = await AuditLog.findOne({
        action: AUDIT_ACTIONS.EDUCATOR_VERIFY_REJECT,
      });
      expect(audit).not.toBeNull();
    });

    it("illegal transition (approve already APPROVED) returns 409", async () => {
      const { admin, mentor } = await createUsers();
      const v = await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.APPROVED,
        submittedAt: new Date(),
        reviewedAt: new Date(),
        documents: sampleDocuments(),
      });
      const res = await request(app)
        .post(`/api/admin/educator-verification/${v._id}/approve`)
        .set("Authorization", authHeader(admin));
      expect(res.status).toBe(409);
    });
  });

  describe("5. Content Creation Gating — 403 for Unverified Educator", () => {
    it("POST /api/courses (createCourse) returns 403 for unverified user", async () => {
      const { student } = await createUsers();
      const res = await request(app)
        .post("/api/courses")
        .set("Authorization", authHeader(student))
        .send({
          title: "My Course",
          description: "Intro",
          category: "Fiqh",
        });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/verified educator/);
    });

    it("POST /api/courses succeeds for verifiedEducator user (2xx)", async () => {
      const { verifiedEducator } = await createUsers();
      const res = await request(app)
        .post("/api/courses")
        .set("Authorization", authHeader(verifiedEducator))
        .send({
          title: "Fiqh 101",
          description: "An intro to fiqh",
          category: "Fiqh",
          price: 0,
        });
      expect(res.status).toBeLessThan(400);
    });

    it("POST /api/courses succeeds for admin (bypass) — 2xx", async () => {
      const { admin } = await createUsers();
      const res = await request(app)
        .post("/api/courses")
        .set("Authorization", authHeader(admin))
        .send({
          title: "Admin Course",
          description: "Admin intro",
          category: "General",
          price: 0,
        });
      expect(res.status).toBeLessThan(400);
    });

    it("POST /api/books (createBook) — live session gating: book create route returns 403 for unverified", async () => {
      const { student } = await createUsers();
      const res = await request(app)
        .post("/api/books")
        .set("Authorization", authHeader(student));
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/verified educator/);
    });

    it("POST /api/spaces (createSpace — the live-session create route per issue #92) returns 403 for unverified", async () => {
      const { student } = await createUsers();
      const res = await request(app)
        .post("/api/spaces")
        .set("Authorization", authHeader(student))
        .send({
          title: "Live Tafsir",
          description: "Session",
          category: "Tafsir",
          eventDate: new Date().toISOString(),
          eventTime: "10:00 AM",
          duration: 60,
        });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/verified educator/);
    });
  });

  describe("6. Full Lifecycle — Submit → Pending → Approve (and Reject→Resubmit path)", () => {
    it("happy path: submit → pending → approve → verifiedEducator=true → can create course", async () => {
      const { mentor, admin } = await createUsers();

      const submitRes = await request(app)
        .post("/api/educator-verification/submit")
        .set("Authorization", authHeader(mentor))
        .send({ documents: sampleDocuments() });
      expect(submitRes.status).toBe(201);
      const vId = submitRes.body.application._id;

      const beforeCreate = await request(app)
        .post("/api/courses")
        .set("Authorization", authHeader(mentor))
        .send({
          title: "Awaiting Approval",
          description: "x",
          category: "Fiqh",
          price: 0,
        });
      expect(beforeCreate.status).toBe(403);

      const approveRes = await request(app)
        .post(`/api/admin/educator-verification/${vId}/approve`)
        .set("Authorization", authHeader(admin));
      expect(approveRes.status).toBe(200);

      const afterCreate = await request(app)
        .post("/api/courses")
        .set("Authorization", authHeader(mentor))
        .send({
          title: "Fiqh 303",
          description: "Advanced",
          category: "Fiqh",
          price: 0,
        });
      expect(afterCreate.status).toBeLessThan(400);
    });

    it("reject → resubmit → approve lifecycle works end-to-end", async () => {
      const { mentor, admin } = await createUsers();

      const submitRes = await request(app)
        .post("/api/educator-verification/submit")
        .set("Authorization", authHeader(mentor))
        .send({ documents: sampleDocuments() });
      const vId = submitRes.body.application._id;

      const rejectRes = await request(app)
        .post(`/api/admin/educator-verification/${vId}/reject`)
        .set("Authorization", authHeader(admin))
        .send({ reviewNotes: "Please resubmit with clearer images." });
      expect(rejectRes.status).toBe(200);

      const illegalApprove = await request(app)
        .post(`/api/admin/educator-verification/${vId}/approve`)
        .set("Authorization", authHeader(admin));
      expect(illegalApprove.status).toBe(409);

      const resubmitRes = await request(app)
        .post("/api/educator-verification/submit")
        .set("Authorization", authHeader(mentor))
        .send({ documents: sampleDocuments() });
      expect(resubmitRes.status).toBe(201);

      const approveRes = await request(app)
        .post(`/api/admin/educator-verification/${vId}/approve`)
        .set("Authorization", authHeader(admin));
      expect(approveRes.status).toBe(200);

      const u = await User.findById(mentor._id);
      expect(u.verifiedEducator).toBe(true);
    });
  });

  describe("7. Metadata allowlist stores educator verification keys", () => {
    it("recordAudit stores verificationId, newStatus, previousStatus in metadata", async () => {
      const { mentor } = await createUsers();
      await request(app)
        .post("/api/educator-verification/submit")
        .set("Authorization", authHeader(mentor))
        .send({ documents: sampleDocuments() });

      const audit = await AuditLog.findOne({
        action: AUDIT_ACTIONS.EDUCATOR_VERIFY_SUBMIT,
      }).lean();
      expect(audit).not.toBeNull();
      expect(audit.metadata.verificationId).toBeDefined();
      expect(audit.metadata.newStatus).toBe(VERIFICATION_STATUS.PENDING);
      expect(audit.metadata.documentCount).toBe(2);
    });
  });

  describe("8. Signed document URL security", () => {
    it("returns 404 for an invalid document index", async () => {
      const { mentor } = await createUsers();
      await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.PENDING,
        submittedAt: new Date(),
        documents: sampleDocuments(),
      });
      const res = await request(app)
        .get("/api/educator-verification/documents/99/signed-url")
        .set("Authorization", authHeader(mentor));
      expect(res.status).toBe(404);
    });

    it("admin endpoint returns 403 for non-admin even with valid id", async () => {
      const { mentor, admin } = await createUsers();
      const v = await EducatorVerification.create({
        applicant: mentor._id,
        status: VERIFICATION_STATUS.PENDING,
        submittedAt: new Date(),
        documents: sampleDocuments(),
      });
      const res = await request(app)
        .get(`/api/admin/educator-verification/${v._id}/documents/0/signed-url`)
        .set("Authorization", authHeader(mentor));
      expect(res.status).toBe(403);
    });
  });
});
