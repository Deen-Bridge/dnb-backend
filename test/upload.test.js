import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.JWT_SECRET = "testsecret_long_enough_for_test_123456789";
process.env.PORT = "5000";
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://localhost:27017/test";
process.env.CLOUDINARY_CLOUD_NAME = "test_cloud_name";
process.env.CLOUDINARY_API_KEY = "test_api_key";
process.env.CLOUDINARY_API_SECRET = "unique_secret_not_in_output";

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
      expect(resStr).not.toContain(process.env.CLOUDINARY_API_SECRET || "undefined");
    });
  });
});
