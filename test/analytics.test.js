import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import Transaction from "../src/models/Transaction.js";

describe("Revenue analytics endpoints", () => {
  let mongoServer;
  let adminToken;
  let educatorToken;
  let studentToken;
  let educator;
  let admin;
  let student;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    educator = await User.create({
      name: "Educator",
      email: "educator@example.com",
      password: "password123",
      role: "tutor",
    });
    admin = await User.create({
      name: "Admin",
      email: "admin@example.com",
      password: "password123",
      role: "admin",
    });
    student = await User.create({
      name: "Student",
      email: "student@example.com",
      password: "password123",
      role: "student",
    });

    educatorToken = jwt.sign({ userId: educator._id, sessionId: "s1" }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024");
    adminToken = jwt.sign({ userId: admin._id, sessionId: "s2" }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024");
    studentToken = jwt.sign({ userId: student._id, sessionId: "s3" }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024");
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Course.deleteMany({}),
      Transaction.deleteMany({}),
    ]);

    educator = await User.create({
      name: "Educator",
      email: "educator@example.com",
      password: "password123",
      role: "tutor",
    });
    admin = await User.create({
      name: "Admin",
      email: "admin@example.com",
      password: "password123",
      role: "admin",
    });
    student = await User.create({
      name: "Student",
      email: "student@example.com",
      password: "password123",
      role: "student",
    });

    educatorToken = jwt.sign({ userId: educator._id, sessionId: "s1" }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024");
    adminToken = jwt.sign({ userId: admin._id, sessionId: "s2" }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024");
    studentToken = jwt.sign({ userId: student._id, sessionId: "s3" }, process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024");
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it("returns educator earnings data with precise decimal strings", async () => {
    await Course.create({
      title: "Course 1",
      description: "A test course",
      category: "Tech",
      createdBy: educator._id,
      price: 5,
    });

    await Transaction.create([
      {
        stellarTxHash: "hash-1",
        buyer: student._id,
        buyerWallet: "G123",
        creator: educator._id,
        creatorWallet: "G456",
        itemType: "course",
        itemId: new mongoose.Types.ObjectId(),
        itemTypeModel: "Course",
        itemTitle: "Course 1",
        amount: "10.0000001",
        network: "testnet",
        status: "confirmed",
        confirmedAt: new Date("2024-06-01T00:00:00.000Z"),
      },
      {
        stellarTxHash: "hash-2",
        buyer: student._id,
        buyerWallet: "G123",
        creator: educator._id,
        creatorWallet: "G456",
        itemType: "course",
        itemId: new mongoose.Types.ObjectId(),
        itemTypeModel: "Course",
        itemTitle: "Course 2",
        amount: "2.0000001",
        network: "testnet",
        status: "confirmed",
        confirmedAt: new Date("2024-06-02T00:00:00.000Z"),
      },
      {
        stellarTxHash: "hash-3",
        buyer: student._id,
        buyerWallet: "G123",
        creator: educator._id,
        creatorWallet: "G456",
        itemType: "course",
        itemId: new mongoose.Types.ObjectId(),
        itemTypeModel: "Course",
        itemTitle: "Course 3",
        amount: "1.0000001",
        network: "testnet",
        status: "pending",
        confirmedAt: new Date("2024-06-03T00:00:00.000Z"),
      },
    ]);

    const res = await request(app)
      .get("/api/analytics/me/earnings")
      .set("Authorization", `Bearer ${educatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.totalVolume).toBe("12.0000002");
    expect(res.body.summary.transactionCount).toBe(2);
    expect(res.body.items[0].title).toBe("Course 1");
  });

  it("blocks non-admin access to platform analytics and allows admins", async () => {
    const studentRes = await request(app)
      .get("/api/analytics/platform")
      .set("Authorization", `Bearer ${studentToken}`);

    expect(studentRes.status).toBe(403);

    const adminRes = await request(app)
      .get("/api/analytics/platform")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.success).toBe(true);
    expect(adminRes.body.summary.transactionCount).toBe(0);
  });
});
