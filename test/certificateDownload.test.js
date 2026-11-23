import { setTimeout as delay } from "node:timers/promises";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import Course from "../src/models/Course.js";
import Certificate from "../src/models/certificate.model.js";
import User from "../src/models/User.js";
import AuditLog, { AUDIT_ACTIONS } from "../src/models/AuditLog.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";

/**
 * Issue #701 — certificate PDF delivery.
 *
 * The download endpoint must not serve a certificate to anyone who merely
 * knows (or guesses) its identifier, must not leak internal lookup errors,
 * and must leave an audit trail for both the allowed and denied paths.
 */
/** recordAudit() is fire-and-forget, so give the write a moment to land. */
async function waitForAudit(filter, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await AuditLog.findOne(filter);
    if (row) return row;
    await delay(25);
  }
  return null;
}

describe("Certificate download authorization (#701)", () => {
  let mongoServer;
  let owner;
  let ownerToken;
  let strangerToken;
  let adminToken;
  let certificate;
  let course;

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
    await Promise.all([Certificate.deleteMany({}), Course.deleteMany({}), User.deleteMany({})]);
    // AuditLog is append-only (model hooks reject deleteMany); clear the
    // collection directly, as the other audit-aware suites do.
    await AuditLog.collection.deleteMany({});

    const ownerAuth = await seedUserAndLogin(app, { email: "cert_owner@example.com" });
    owner = ownerAuth.user;
    ownerToken = ownerAuth.token;

    const strangerAuth = await seedUserAndLogin(app, { email: "cert_stranger@example.com" });
    strangerToken = strangerAuth.token;

    const adminAuth = await seedUserAndLogin(app, {
      email: "cert_admin@example.com",
      role: "admin",
    });
    adminToken = adminAuth.token;

    course = await Course.create({
      title: "Fiqh of Transactions",
      description: "Course used by the certificate download suite",
      category: "fiqh",
      price: 0,
      createdBy: owner._id,
    });

    certificate = await Certificate.create({
      certificateId: "CERT-DL-0001",
      user: owner._id,
      course: course._id,
      learnerName: owner.name,
      courseTitle: course.title,
      completionDate: new Date("2026-01-15T00:00:00.000Z"),
      instructorName: "Shaykh Test",
      certificateUrl: "https://cdn.deenbridge.test/certificates/CERT-DL-0001.pdf",
      certificateHash: "0xabc123",
      verificationUrl: "https://deenbridge.test/verify/CERT-DL-0001",
    });
  });

  const downloadUrl = (id) => `/api/certificates/${id}/download`;

  it("rejects an anonymous request", async () => {
    const res = await request(app).get(downloadUrl(certificate.certificateId));
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).not.toBe("application/pdf");
  });

  it("denies a different authenticated user and records the denial", async () => {
    const res = await request(app)
      .get(downloadUrl(certificate.certificateId))
      .set("Authorization", `Bearer ${strangerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    const denied = await waitForAudit({
      action: AUDIT_ACTIONS.CERTIFICATE_DOWNLOAD_DENIED,
      targetId: certificate.certificateId,
    });
    expect(denied).not.toBeNull();
    expect(denied.status).toBe("failure");
  });

  it("serves the PDF to the certificate owner with hardened headers", async () => {
    const res = await request(app)
      .get(downloadUrl(certificate.certificateId))
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="CERT-DL-0001.pdf"'
    );
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");

    const recorded = await waitForAudit({
      action: AUDIT_ACTIONS.CERTIFICATE_DOWNLOAD,
      targetId: certificate.certificateId,
    });
    expect(recorded).not.toBeNull();
    expect(recorded.status).toBe("success");
  });

  it("serves the PDF to an administrator", async () => {
    const res = await request(app)
      .get(downloadUrl(certificate.certificateId))
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  });

  it("returns a generic 404 for an unknown identifier without leaking internals", async () => {
    const res = await request(app)
      .get(downloadUrl("CERT-DOES-NOT-EXIST"))
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Certificate not found");
    expect(JSON.stringify(res.body)).not.toMatch(/CastError|Mongoose|stack|at \//);

    const denied = await waitForAudit({
      action: AUDIT_ACTIONS.CERTIFICATE_DOWNLOAD_DENIED,
      targetId: "CERT-DOES-NOT-EXIST",
    });
    expect(denied).not.toBeNull();
  });
});
