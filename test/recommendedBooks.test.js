import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import app from "../app.js";
import Book from "../src/models/Book.js";
import User from "../src/models/User.js";

describe("Recommended books endpoint (Issue #7)", () => {
  let mongoServer;
  let author;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  beforeEach(async () => {
    await Promise.all([Book.deleteMany({}), User.deleteMany({})]);
    author = await User.create({
      name: "Scholar Author",
      email: "scholar@example.com",
      password: "password123",
      role: "mentor",
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it("returns books matching interests category via query parameter", async () => {
    await Book.create([
      {
        title: "Fiqh Basics",
        category: "Fiqh",
        author: author._id,
        description: "Intro to Fiqh",
        image: "https://example.com/1.jpg",
        fileUrl: "https://example.com/1.pdf",
        readCount: 50,
      },
      {
        title: "Hadith Studies",
        category: "Hadith",
        author: author._id,
        description: "Intro to Hadith",
        image: "https://example.com/2.jpg",
        fileUrl: "https://example.com/2.pdf",
        readCount: 30,
      },
      {
        title: "History of Islam",
        category: "History",
        author: author._id,
        description: "Islamic History",
        image: "https://example.com/3.jpg",
        fileUrl: "https://example.com/3.pdf",
        readCount: 10,
      },
    ]);

    const res = await request(app).get("/api/books/recom?interests=Fiqh,Hadith");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.recommended).toBeDefined();
    expect(res.body.recommended.length).toBe(2);
    const titles = res.body.recommended.map((b) => b.title);
    expect(titles).toContain("Fiqh Basics");
    expect(titles).toContain("Hadith Studies");
  });

  it("falls back to popular books when no interests are provided", async () => {
    await Book.create([
      {
        title: "Popular Book 1",
        category: "General",
        author: author._id,
        description: "Popular",
        image: "https://example.com/1.jpg",
        fileUrl: "https://example.com/1.pdf",
        readCount: 100,
      },
      {
        title: "Popular Book 2",
        category: "General",
        author: author._id,
        description: "Popular",
        image: "https://example.com/2.jpg",
        fileUrl: "https://example.com/2.pdf",
        readCount: 80,
      },
    ]);

    const res = await request(app).get("/api/books/recom");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.recommended.length).toBe(2);
    expect(res.body.recommended[0].title).toBe("Popular Book 1");
  });

  it("rejects invalid interests format with 400", async () => {
    const res = await request(app)
      .post("/api/books/recom")
      .send({ interests: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
