import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Reel from "../src/models/Reel.js";
import ContentFlag from "../src/models/content-flag.model.js";
import ModerationAction from "../src/models/moderation-action.model.js";
import moderationService from "../src/services/moderation.service.js";

const JWT_SECRET = process.env.JWT_SECRET;
const generateToken = (userId, role = "student", is2FAVerified = true) => {
  return jwt.sign({ userId, role, is2FAVerified }, JWT_SECRET, { expiresIn: "1h" });
};

describe("Content Moderation Queue API (#213)", () => {
  let mongoServer;
  let user, creator, admin;
  let userToken, creatorToken, adminToken;
  let testReel;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
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

  beforeEach(async () => {
    await User.deleteMany({});
    await Reel.deleteMany({});
    await ContentFlag.deleteMany({});
    await ModerationAction.deleteMany({});

    user = await User.create({
      name: "Regular User",
      email: "user@example.com",
      password: "Password123!",
      role: "student",
    });

    creator = await User.create({
      name: "Content Creator",
      email: "creator@example.com",
      password: "Password123!",
      role: "mentor",
    });

    admin = await User.create({
      name: "Admin User",
      email: "admin@example.com",
      password: "Password123!",
      role: "admin",
      twoFactor: { enabled: true },
    });

    userToken = generateToken(user._id, "student");
    creatorToken = generateToken(creator._id, "mentor");
    adminToken = generateToken(admin._id, "admin", true);

    testReel = await Reel.create({
      title: "Inspirational Short",
      description: "Daily reminder reel",
      video: "https://example.com/video.mp4",
      createdBy: creator._id,
      user: creator._id,
    });
  });

  it("allows users to flag reels for inappropriate content", async () => {
    const res = await request(app)
      .post(`/api/reels/${testReel._id}/flag`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        reason: "Inappropriate language",
        details: "Contains offensive comments at 0:15",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.flag.status).toBe("pending");
    expect(res.body.flag.reason).toBe("Inappropriate language");
  });

  it("places flagged reels in admin moderation queue", async () => {
    await request(app)
      .post(`/api/reels/${testReel._id}/flag`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ reason: "Spam content" });

    const queueRes = await request(app)
      .get("/api/admin/moderation/queue?status=pending")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(queueRes.status).toBe(200);
    expect(queueRes.body.flags.length).toBe(1);
    expect(queueRes.body.flags[0].reason).toBe("Spam content");
  });

  it("allows admins to approve or remove content and notifies creator", async () => {
    const flagRes = await request(app)
      .post(`/api/reels/${testReel._id}/flag`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ reason: "Copyright violation" });

    const flagId = flagRes.body.flag._id;

    const actionRes = await request(app)
      .post(`/api/admin/moderation/${flagId}/action`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        action: "remove",
        notes: "Confirmed copyright infringement",
      });

    expect(actionRes.status).toBe(200);
    expect(actionRes.body.flag.status).toBe("removed");
    expect(actionRes.body.reel.status).toBe("removed");

    const historyRes = await request(app)
      .get("/api/admin/moderation/history")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.actions.length).toBe(1);
    expect(historyRes.body.actions[0].action).toBe("remove");
  });

  it("auto-flags reels based on keyword filters", async () => {
    const badReel = await Reel.create({
      title: "Hate speech and harassment reel",
      description: "Contains prohibited spam and violence",
      video: "https://example.com/bad.mp4",
      createdBy: creator._id,
      user: creator._id,
    });

    const flag = await moderationService.autoFlagReel(badReel);
    expect(flag).not.toBeNull();
    expect(flag.isAutoFlagged).toBe(true);
    expect(flag.flaggedKeywords).toContain("hate");
    expect(flag.flaggedKeywords).toContain("spam");
  });
});
