import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import Course from "../src/models/Course.js";
import CourseProgress from "../src/models/CourseProgress.js";
import Certificate from "../src/models/certificate.model.js";
import User from "../src/models/User.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";

describe("Course Certificates API", () => {
  let mongoServer;
  let token;
  let user;
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
    await Certificate.deleteMany({});
    await CourseProgress.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    const auth = await seedUserAndLogin(app, { email: "certificate_student@example.com" });
    token = auth.token;
    user = auth.user;

    course = await Course.create({
      title: "Fullstack Web Development",
      description: "Master Node and React",
      category: "Programming",
      price: 0,
      createdBy: user._id,
    });
  });

  it("should fail generating certificate if course is incomplete", async () => {
    await CourseProgress.create({
      user: user._id,
      course: course._id,
      percentComplete: 50,
    });

    const res = await request(app)
      .post("/api/certificates/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ courseId: course._id });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not been completed/i);
  });

  it("should generate certificate when course is 100% complete", async () => {
    await CourseProgress.create({
      user: user._id,
      course: course._id,
      percentComplete: 100,
      completedAt: new Date(),
    });

    const res = await request(app)
      .post("/api/certificates/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ courseId: course._id });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.certificateId).toMatch(/^cert_/);
    expect(res.body.data.learnerName).toBe(user.name);
    expect(res.body.data.courseTitle).toBe(course.title);
  });

  it("should download PDF certificate", async () => {
    const cert = await Certificate.create({
      certificateId: "CERT-TEST-12345",
      user: user._id,
      course: course._id,
      learnerName: user.name,
      courseTitle: course.title,
      completionDate: new Date(),
      certificateUrl: "/api/certificates/CERT-TEST-12345/download",
    });

    const res = await request(app).get(`/api/certificates/${cert.certificateId}/download`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/CERT-TEST-12345\.pdf/);
  });
});
