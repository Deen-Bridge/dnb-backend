import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../app.js";

describe("Upload Routes", () => {
  let mongoServer;
  let token;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    const authRes = await request(app)
      .post("/api/auth/register")
      .send({ name: "Uploader", email: "uploader@example.com", password: "password", role: "student" });
    token = authRes.body.accessToken;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
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
      expect(res.body.data).toHaveProperty("cloudName");
      expect(res.body.data).toHaveProperty("apiKey");
      
      // Ensure we don't leak the API secret
      const resStr = JSON.stringify(res.body);
      expect(process.env.CLOUDINARY_API_SECRET).toBeDefined();
      expect(resStr).not.toContain(process.env.CLOUDINARY_API_SECRET);
    });
  });

  describe("PUT /api/users/update/:id", () => {
    it("should allow the owner to update their profile", async () => {
      // Find the user created in beforeAll
      const userRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      const userId = userRes.body.user._id;

      const res = await request(app)
        .put(`/api/users/update/${userId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ bio: "Updated bio" });
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 403 if user tries to update another user's profile", async () => {
      const otherAuthRes = await request(app)
        .post("/api/auth/register")
        .send({ name: "Other", email: "other@example.com", password: "password", role: "student" });
      
      const otherUserId = otherAuthRes.body.user._id || otherAuthRes.body.user.id;

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
