import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";
import {
  calculateProfileCompletion,
  getCompletionLevel,
  DEFAULT_PROFILE_FIELDS,
} from "../src/utils/profileCompletion.js";

describe("Profile Completion System", () => {
  let mongoServer;
  let token;
  let user;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (process.env.MONGO_URI) {
      try {
        await mongoose.connect(process.env.MONGO_URI, {
          serverSelectionTimeoutMS: 2000,
        });
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
    await User.deleteMany({});
    const auth = await seedUserAndLogin(app, {
      email: "profile_test@example.com",
      name: "Ahmed Al-Farsi",
    });
    token = auth.token;
    user = auth.user;
  });

  describe("Utility - calculateProfileCompletion", () => {
    it("should return 0% completion for null or empty user", () => {
      const nullRes = calculateProfileCompletion(null);
      expect(nullRes.percentage).toBe(0);
      expect(nullRes.earnedPoints).toBe(0);
      expect(nullRes.isComplete).toBe(false);
      expect(nullRes.level).toBe("Beginner");
      expect(nullRes.completedCount).toBe(0);
      expect(nullRes.missingFields.length).toBe(DEFAULT_PROFILE_FIELDS.length);
      expect(nullRes.suggestions.length).toBeGreaterThan(0);

      const emptyRes = calculateProfileCompletion({});
      expect(emptyRes.percentage).toBe(0);
      expect(emptyRes.earnedPoints).toBe(0);
    });

    it("should calculate weighted scoring accurately for partial profile", () => {
      const partialUser = {
        avatar: "https://res.cloudinary.com/demo/image/upload/sample.jpg", // 20
        bio: "Passionate student of Islamic jurisprudence.", // 20
        country: "Morocco", // 10
      };

      const result = calculateProfileCompletion(partialUser);
      // 20 + 20 + 10 = 50%
      expect(result.earnedPoints).toBe(50);
      expect(result.percentage).toBe(50);
      expect(result.level).toBe("Intermediate");
      expect(result.completedFields).toEqual(
        expect.arrayContaining(["avatar", "bio", "country"])
      );
      expect(result.missingFields).toEqual(
        expect.arrayContaining(["interests", "language", "gender", "age", "stellarWallet", "twoFactor"])
      );
      // Suggestions should prioritize highest weight missing fields (e.g. interests 15, language/stellarWallet 10)
      expect(result.suggestions.length).toBe(6);
      expect(result.nextStep).toBeTruthy();
    });

    it("should return 100% completion for a fully filled profile", () => {
      const fullUser = {
        name: "Fatima Zahra",
        avatar: "https://res.cloudinary.com/demo/avatar.jpg", // 20
        bio: "Researcher in Hadith studies and Arabic linguistics.", // 20
        country: "Jordan", // 10
        interests: ["Hadith", "Arabic Grammar"], // 15
        language: "Arabic", // 10
        gender: "female", // 5
        age: 26, // 5
        stellarWallet: {
          publicKey: "GA2XG5U3WO5B7ST2ND73MQRHDEVWJBRT25FB6TACWOB2UWME2NIFZOPL", // 10
        },
        twoFactor: {
          enabled: true, // 5
        },
      };

      const result = calculateProfileCompletion(fullUser);
      expect(result.percentage).toBe(100);
      expect(result.earnedPoints).toBe(100);
      expect(result.totalPossiblePoints).toBe(100);
      expect(result.isComplete).toBe(true);
      expect(result.level).toBe("Complete");
      expect(result.missingFields).toHaveLength(0);
      expect(result.suggestions).toHaveLength(0);
      expect(result.nextStep).toBeNull();
    });

    it("should correctly handle invalid or whitespace-only values", () => {
      const invalidUser = {
        avatar: "   ",
        bio: "",
        country: "  ",
        interests: ["", "  "],
        language: "",
        gender: "other", // invalid enum
        age: 1, // below minimum 2
        stellarWallet: {
          publicKey: "",
        },
        twoFactor: {
          enabled: false,
        },
      };

      const result = calculateProfileCompletion(invalidUser);
      expect(result.percentage).toBe(0);
      expect(result.completedCount).toBe(0);
      expect(result.isComplete).toBe(false);
    });

    it("should map levels properly with getCompletionLevel", () => {
      expect(getCompletionLevel(0)).toBe("Beginner");
      expect(getCompletionLevel(34)).toBe("Beginner");
      expect(getCompletionLevel(35)).toBe("Intermediate");
      expect(getCompletionLevel(69)).toBe("Intermediate");
      expect(getCompletionLevel(70)).toBe("Advanced");
      expect(getCompletionLevel(99)).toBe("Advanced");
      expect(getCompletionLevel(100)).toBe("Complete");
    });
  });

  describe("API Endpoints", () => {
    it("GET /api/users/completion/criteria - should return criteria details", async () => {
      const res = await request(app).get("/api/users/completion/criteria");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalWeight).toBe(100);
      expect(Array.isArray(res.body.data.fields)).toBe(true);
      expect(res.body.data.levels).toHaveProperty("Complete");
    });

    it("GET /api/users/completion - should reject unauthenticated requests", async () => {
      const res = await request(app).get("/api/users/completion");
      expect(res.status).toBe(401);
    });

    it("GET /api/users/completion - should return authenticated user completion", async () => {
      const res = await request(app)
        .get("/api/users/completion")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("percentage");
      expect(res.body.data).toHaveProperty("level");
      expect(res.body.data).toHaveProperty("fields");
      expect(res.body.data).toHaveProperty("suggestions");
      expect(res.body.data.userId.toString()).toBe(user._id.toString());
    });

    it("GET /api/users/completion/me - should return current user completion", async () => {
      const res = await request(app)
        .get("/api/users/completion/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.percentage).toBeDefined();
    });

    it("GET /api/users/completion/:userId - should return completion for specified user", async () => {
      const targetUser = await User.create({
        name: "Target Learner",
        email: "target_learner@example.com",
        password: "HashedPassword123!",
        bio: "Learning Arabic and Tajweed",
        country: "Egypt",
        interests: ["Tajweed", "Arabic"],
      });

      const res = await request(app)
        .get(`/api/users/completion/${targetUser._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userId.toString()).toBe(targetUser._id.toString());
      expect(res.body.data.percentage).toBeGreaterThan(0);
    });

    it("GET /api/users/:userId/completion - should also resolve via user routes", async () => {
      const res = await request(app)
        .get(`/api/users/${user._id}/completion`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userId.toString()).toBe(user._id.toString());
    });

    it("GET /api/users/completion/:userId - should return 404 for non-existent user", async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .get(`/api/users/completion/${nonExistentId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should reflect increased completion percentage after updating profile", async () => {
      const initialRes = await request(app)
        .get("/api/users/completion/me")
        .set("Authorization", `Bearer ${token}`);

      const initialPercentage = initialRes.body.data.percentage;

      // Update user with bio, country, and interests
      await request(app)
        .put(`/api/users/update/${user._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          bio: "Student pursuing Islamic finance & economics.",
          country: "United Kingdom",
          interests: ["Islamic Finance", "Economics"],
        });

      const updatedRes = await request(app)
        .get("/api/users/completion/me")
        .set("Authorization", `Bearer ${token}`);

      expect(updatedRes.status).toBe(200);
      expect(updatedRes.body.data.percentage).toBeGreaterThan(initialPercentage);
      expect(updatedRes.body.data.completedFields).toEqual(
        expect.arrayContaining(["bio", "country", "interests"])
      );
    });
  });
});
