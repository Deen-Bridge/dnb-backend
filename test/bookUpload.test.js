import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { PassThrough } from "stream";

import app from "../app.js";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import cloudinary from "../src/utils/cloudinary.js";

import * as fileValidation from "../src/utils/fileValidation.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";

// Need realistic magic bytes for file-type detection
const validPdfBytes = Buffer.from("%PDF-1.4\n%EOF\n");
const validImageBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);

describe("Media Upload Hardening", () => {
  jest.setTimeout(30000);
  let token;
  let testUser;
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    // Mock cloudinary upload stream
    jest.spyOn(cloudinary.uploader, "upload_stream").mockImplementation((options, cb) => {
      const pass = new PassThrough();
      pass.on('data', () => {}); // Consume data to prevent backpressure
      pass.on('end', () => cb(null, { secure_url: "https://example.com/file", public_id: "mock_public_id" }));
      return pass;
    });

    jest.spyOn(cloudinary.utils, "private_download_url").mockImplementation(() => {
      return "https://example.com/signed-url";
    });

    const { token: authToken, user } = await seedUserAndLogin(app, {
      name: "Uploader",
      email: "uploader@example.com",
    });
    token = authToken;
    testUser = user;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
    jest.restoreAllMocks();
  });


  it("should reject oversized files (Multer limits)", async () => {
    const largeBuffer = Buffer.alloc(55 * 1024 * 1024); // 55MB (limit is 50MB)

    const res = await request(app)
      .post("/api/books")
      .set("Authorization", `Bearer ${token}`)
      .attach("thumbnail", largeBuffer, "large.jpg")
      .attach("file", validPdfBytes, "book.pdf")
      .field("title", "Test Book")
      .field("category", "Test")
      .field("price", 10)
      .field("description", "Test Description");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/File too large/i);
  });

  it("should reject mismatched magic bytes (server validation)", async () => {
    const res = await request(app)
      .post("/api/books")
      .set("Authorization", `Bearer ${token}`)
      .attach("thumbnail", validImageBytes, "thumb.jpg")
      .attach("file", Buffer.from("this is a fake pdf text file"), "book.pdf")
      .field("title", "Fake PDF")
      .field("category", "Test")
      .field("price", 10)
      .field("description", "Test Description");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid file content/i);
  });

  it("should upload a valid book and store filePublicId", async () => {
    const res = await request(app)
      .post("/api/books")
      .set("Authorization", `Bearer ${token}`)
      .attach("thumbnail", validImageBytes, "thumb.jpg")
      .attach("file", validPdfBytes, "book.pdf")
      .field("title", "Valid Book")
      .field("category", "Test")
      .field("price", 10)
      .field("description", "Test Description");

    if (res.status === 500) {
      console.log("500 Body:", res.body);
    }
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty("filePublicId");
  });

  it("should deny unentitled user access to paid book", async () => {
    const book = await Book.create({
      title: "Paid Book",
      author: testUser.id || testUser._id,
      category: "Test",
      price: 10,
      description: "Desc",
      image: "url",
      fileUrl: "url",
      filePublicId: "paid_public_id"
    });

    const { token: poorToken } = await seedUserAndLogin(app, {
      name: "Poor",
      email: "poor@example.com",
    });

    const res = await request(app)
      .get(`/api/books/${book._id}/preview`)
      .set("Authorization", `Bearer ${poorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/do not have access/i);
  });

  it("should provide signed URL to entitled user", async () => {
    const book = await Book.create({
      title: "My Paid Book",
      author: testUser.id || testUser._id, // testUser is the author, so they are entitled
      category: "Test",
      price: 10,
      description: "Desc",
      image: "url",
      fileUrl: "url",
      filePublicId: "paid_public_id"
    });

    const res = await request(app)
      .get(`/api/books/${book._id}/preview`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://example.com/signed-url");
  });
});
