import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import ReadingProgress from "../src/models/ReadingProgress.js";

const JWT_SECRET = process.env.JWT_SECRET;
const generateToken = (userId, role = "student") =>
  jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "1h" });

describe("Reading progress sync API (#203)", () => {
  let mongoServer;
  let user;
  let author;
  let token;
  let book;

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
    await Promise.all([
      User.deleteMany({}),
      Book.deleteMany({}),
      ReadingProgress.deleteMany({}),
    ]);

    author = await User.create({
      name: "Author",
      email: "author@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
    });
    user = await User.create({
      name: "Reader",
      email: "reader@example.com",
      password: "Qx7#vLmp92Zt",
      role: "student",
    });
    token = generateToken(user._id);

    book = await Book.create({
      title: "The Sealed Nectar",
      author: author._id,
      description: "A biography",
      image: "https://example.com/cover.jpg",
      fileUrl: "https://example.com/book.pdf",
    });
  });

  it("upserts exactly one record per user + book", async () => {
    const first = await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${token}`)
      .send({ page: 10, totalPages: 100 });

    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);
    expect(first.body.progress.percentage).toBe(10);

    await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${token}`)
      .send({ page: 25, totalPages: 100 });

    const count = await ReadingProgress.countDocuments({
      user: user._id,
      book: book._id,
    });
    expect(count).toBe(1);
  });

  it("overwrites progress and bumps updatedAt / version on update", async () => {
    const created = await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${token}`)
      .send({ page: 5, percentage: 5, lastPosition: "cfi(/2)" });

    const firstVersion = created.body.progress.version;
    const firstUpdatedAt = new Date(created.body.progress.updatedAt).getTime();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const updated = await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${token}`)
      .send({ page: 40, percentage: 40, lastPosition: "cfi(/8)" });

    expect(updated.body.progress.percentage).toBe(40);
    expect(updated.body.progress.lastPosition).toBe("cfi(/8)");
    expect(updated.body.progress.version).toBe(firstVersion + 1);
    expect(new Date(updated.body.progress.updatedAt).getTime()).toBeGreaterThan(
      firstUpdatedAt
    );
  });

  it("returns the last stored position so the reader can resume", async () => {
    await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${token}`)
      .send({ page: 73, percentage: 73, lastPosition: "cfi(/15)" });

    const res = await request(app)
      .get(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.progress.page).toBe(73);
    expect(res.body.progress.percentage).toBe(73);
    expect(res.body.progress.lastPosition).toBe("cfi(/15)");
  });

  it("returns null progress when nothing has been stored yet", async () => {
    const res = await request(app)
      .get(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.progress).toBeNull();
  });

  it("rejects a percentage greater than 100", async () => {
    const res = await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${token}`)
      .send({ percentage: 150 });

    expect(res.status).toBe(400);
  });

  it("rejects a percentage below 0", async () => {
    const res = await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${token}`)
      .send({ percentage: -5 });

    expect(res.status).toBe(400);
  });

  it("includes progress percentage on the library listing", async () => {
    await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${token}`)
      .send({ page: 50, totalPages: 100 });

    const res = await request(app)
      .get(`/api/books/library/progress`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.library).toHaveLength(1);
    expect(res.body.library[0].percentage).toBe(50);
    expect(res.body.library[0].book._id.toString()).toBe(book._id.toString());
  });
});
