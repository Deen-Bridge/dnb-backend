import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../app.js";
import cloudinary from "../src/utils/cloudinary.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";

describe("Upload Routes", () => {
  jest.setTimeout(30000);
  let mongoServer;
  let token;
  let testUserId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    const { token: authToken, user } = await seedUserAndLogin(app, {
      name: "Uploader",
      email: "uploader@example.com",
    });
    token = authToken;
    testUserId = user._id.toString();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });


  describe("POST /api/uploads/signature", () => {
    it("should reject unauthenticated requests", async () => {
      const res = await request(app).post("/api/uploads/signature");
      
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("should generate a signature for authenticated requests", async () => {
      const res = await request(app)
        .post("/api/uploads/signature")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Signature generated successfully");
      expect(res.body.data).toHaveProperty("signature");
      expect(res.body.data).toHaveProperty("timestamp");
      const config = cloudinary.config();
      expect(res.body.data).toHaveProperty("cloudName");
      expect(res.body.data).toHaveProperty("apiKey");
      
      // Ensure we don't leak the API secret
      const resStr = JSON.stringify(res.body);
      const apiSecret = config.api_secret;
      expect(apiSecret).toBeDefined();
      expect(resStr).not.toContain(apiSecret);
    });
  });

  describe("PUT /api/users/update/:id", () => {
    it("should allow the owner to update their profile", async () => {
      const res = await request(app)
        .put(`/api/users/update/${testUserId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ bio: "Updated bio" });
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 403 if user tries to update another user's profile", async () => {
      const { user: otherUser } = await seedUserAndLogin(app, {
        name: "Other",
        email: "other@example.com",
      });
      const otherUserId = otherUser._id.toString();

      const res = await request(app)
        .put(`/api/users/update/${otherUserId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ bio: "Malicious update" });
      
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Not authorized to update this profile");
      expect(res.body.data).toBeNull();
    });
  });
});
