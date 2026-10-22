import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import Course from "../src/models/Course.js";
import CourseBundle from "../src/models/course-bundle.model.js";
import User from "../src/models/User.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";

describe("Course Bundles API", () => {
  let mongoServer;
  let token;
  let user;
  let course1;
  let course2;

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
    await CourseBundle.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    const auth = await seedUserAndLogin(app, { email: "bundle_creator@example.com" });
    token = auth.token;
    user = auth.user;

    course1 = await Course.create({
      title: "React Fundamentals",
      description: "Learn React from scratch",
      category: "Programming",
      price: 100,
      createdBy: user._id,
    });

    course2 = await Course.create({
      title: "Advanced React",
      description: "Master React patterns",
      category: "Programming",
      price: 150,
      createdBy: user._id,
    });
  });

  it("should create a course bundle and calculate discount percentage", async () => {
    const res = await request(app)
      .post("/api/course-bundles")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Complete React Suite",
        description: "Get both React courses at a discount",
        courses: [course1._id, course2._id],
        price: 200,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.originalPrice).toBe(250);
    expect(res.body.data.discountPercentage).toBe(20);
    expect(res.body.data.courses).toHaveLength(2);
  });

  it("should fetch all course bundles", async () => {
    await CourseBundle.create({
      title: "React Bundle",
      description: "Bundle description",
      courses: [course1._id, course2._id],
      price: 200,
      originalPrice: 250,
      discountPercentage: 20,
      createdBy: user._id,
    });

    const res = await request(app).get("/api/course-bundles");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("React Bundle");
  });

  it("should fetch bundles containing a specific course", async () => {
    await CourseBundle.create({
      title: "React Bundle",
      description: "Bundle description",
      courses: [course1._id, course2._id],
      price: 200,
      originalPrice: 250,
      discountPercentage: 20,
      createdBy: user._id,
    });

    const res = await request(app).get(`/api/course-bundles/course/${course1._id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it("should purchase a bundle and enroll user in all courses", async () => {
    const learnerAuth = await seedUserAndLogin(app, { email: "learner@example.com" });

    const bundle = await CourseBundle.create({
      title: "React Bundle",
      description: "Bundle description",
      courses: [course1._id, course2._id],
      price: 200,
      originalPrice: 250,
      discountPercentage: 20,
      createdBy: user._id,
    });

    const res = await request(app)
      .post(`/api/course-bundles/${bundle._id}/purchase`)
      .set("Authorization", `Bearer ${learnerAuth.token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updatedLearner = await User.findById(learnerAuth.user._id);
    expect(updatedLearner.purchasedCourses).toHaveLength(2);
  });
});
