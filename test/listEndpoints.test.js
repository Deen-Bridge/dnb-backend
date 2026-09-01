import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Book from "../src/models/Book.js";
import Course from "../src/models/Course.js";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongoServer;

const validObjectId = () => new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (process.env.MONGO_URI) {
    try {
      await mongoose.connect(`${process.env.MONGO_URI}_listendpoints`, {
        serverSelectionTimeoutMS: 2000,
      });
      return;
    } catch (_err) {}
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
  await Book.deleteMany({});
  await Course.deleteMany({});
});

describe("Issue #9 — list endpoints never return success:false for empty results", () => {
  it("GET /api/books/by-author/:authorId returns 200 success:true with empty data when author has no books", async () => {
    const res = await request(app).get(`/api/books/by-author/${validObjectId()}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("GET /api/courses/user returns 200 success:true with empty data when user has no courses", async () => {
    const res = await request(app).get(
      `/api/courses/user?createdBy=${validObjectId()}`
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("GET /api/books returns 200 success:true with data array when empty", async () => {
    const res = await request(app).get("/api/books");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /api/courses returns 200 success:true with data array when empty", async () => {
    const res = await request(app).get("/api/courses");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("GET /api/search returns 200 success:true with data envelope even for zero results", async () => {
    // Short query (<3 chars) deliberately returns no results without relying
    // on the `$text` index, exercising the bare-array wrapping for emptiness.
    const res = await request(app).get(`/api/search?q=zz`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.pagination).toBeDefined();
  });
});

describe("Issue #9 — success:false is reserved for genuine errors", () => {
  it("GET /api/books/:id returns 404 success:false for a missing book", async () => {
    const res = await request(app).get(`/api/books/${validObjectId()}`);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/courses/:id returns 404 success:false for a missing course", async () => {
    const res = await request(app).get(`/api/courses/${validObjectId()}`);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/courses/user returns 400 success:false for an invalid ObjectId", async () => {
    const res = await request(app).get("/api/courses/user?createdBy=not-a-real-id");
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe("Issue #9 — populated responses use the data envelope", () => {
  it("GET /api/books returns found books under data", async () => {
    await Book.create({
      title: "Seerah Studies",
      author: validObjectId(),
      description: "A book about the life of the Prophet",
      category: "Biography",
      price: 20,
      image: "url",
      fileUrl: "url",
    });
    const res = await request(app).get("/api/books");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((b) => b.title === "Seerah Studies")).toBe(true);
    expect(res.body.books).toBeUndefined();
  });

  it("GET /api/courses returns published courses under data", async () => {
    await Course.create({
      title: "Fiqh of Worship",
      description: "Comprehensive jurisprudence",
      category: "Fiqh",
      price: 30,
      status: "published",
      createdBy: validObjectId(),
    });
    const res = await request(app).get("/api/courses");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((c) => c.title === "Fiqh of Worship")).toBe(true);
    expect(res.body.courses).toBeUndefined();
  });
});