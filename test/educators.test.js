import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Course from "../src/models/Course.js";
import Book from "../src/models/Book.js";
import User from "../src/models/User.js";
import Space from "../src/models/Space.js";

import { MongoMemoryServer } from "mongodb-memory-server";

let userId1;
let userId2;
let userId3;
let adminId;
let mongoServer;

beforeAll(async () => {
  if (process.env.MONGO_URI && !process.env.MONGO_URI.includes("localhost")) {
    try {
      await mongoose.connect(`${process.env.MONGO_URI}_educators`);
      return;
    } catch (_err) {}
  }
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 60000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  await Course.deleteMany({});
  await Book.deleteMany({});
  await User.deleteMany({});
  await Space.deleteMany({});

  userId1 = new mongoose.Types.ObjectId();
  userId2 = new mongoose.Types.ObjectId();
  userId3 = new mongoose.Types.ObjectId();
  adminId = new mongoose.Types.ObjectId();

  await User.create([
    {
      _id: userId1,
      name: "Aisha Khan",
      email: "aisha@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
      bio: "Fiqh teacher and author.",
    },
    {
      _id: userId2,
      name: "Omar Yusuf",
      email: "omar@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
      bio: "Live-space host.",
    },
    {
      _id: userId3,
      name: "Zaynab Ali",
      email: "zaynab@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
      bio: "Tafsir educator.",
    },
    {
      _id: adminId,
      name: "Admin User",
      email: "admin@example.com",
      password: "Qx7#vLmp92Zt",
      role: "admin",
      bio: "Platform operator.",
    },
  ]);

  // Aisha: 2 courses + 1 book (total 3) · Omar: 1 space (total 1) · Zaynab: 1 course (total 1)
  await Course.create([
    { title: "Fiqh 101", description: "Intro to fiqh.", category: "Fiqh", createdBy: userId1 },
    { title: "Fiqh 202", description: "Advanced fiqh.", category: "Fiqh", createdBy: userId1 },
    { title: "Tafsir Basics", description: "Intro to tafsir.", category: "Tafsir", createdBy: userId3 },
  ]);

  await Book.create([
    {
      title: "Pathways to Prayer",
      description: "Book on prayer.",
      category: "Worship",
      author: userId1,
      image: "img",
      fileUrl: "file",
    },
  ]);

  await Space.create([
    {
      title: "Live Q&A",
      description: "Ask anything.",
      category: "Q&A",
      host: userId2,
      eventDate: new Date(),
      eventTime: "14:00",
      duration: 60,
    },
  ]);
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
});

describe("Educators directory API", () => {
  it("returns the full roster deduped by creator with counts, sorted by total", async () => {
    const res = await request(app).get("/api/educators");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0]._id).toBe(userId1.toString());
    expect(res.body.data[0].courses).toBe(2);
    expect(res.body.data[0].books).toBe(1);
    expect(res.body.data[0].spaces).toBe(0);
    expect(res.body.data[0].total).toBe(3);
    expect(res.body.data[0].name).toBe("Aisha Khan");
    expect(res.body.data[0].role).toBe("Mentor");
    expect(res.body.data[0].bio).toBe("Fiqh teacher and author.");
    expect(res.body.data[0].email).toBeUndefined();
    expect(res.body.data[0].password).toBeUndefined();
  });

  it("sorts ties alphabetically by name", async () => {
    const res = await request(app).get("/api/educators");

    const sorted = [...res.body.data].sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name)
    );
    expect(res.body.data.map((e) => e._id)).toEqual(sorted.map((e) => e._id));
  });

  it("exposes header totals in meta", async () => {
    const res = await request(app).get("/api/educators");

    expect(res.body.meta).toEqual({ educators: 3, courses: 3, books: 1, spaces: 1 });
  });

  it("filters by contribution type", async () => {
    const courses = await request(app).get("/api/educators?type=courses");
    expect(courses.body.data).toHaveLength(2);
    expect(courses.body.data.map((e) => e._id).sort()).toEqual(
      [userId1.toString(), userId3.toString()].sort()
    );

    const books = await request(app).get("/api/educators?type=books");
    expect(books.body.data).toHaveLength(1);
    expect(books.body.data[0]._id).toBe(userId1.toString());

    const spaces = await request(app).get("/api/educators?type=spaces");
    expect(spaces.body.data).toHaveLength(1);
    expect(spaces.body.data[0]._id).toBe(userId2.toString());
  });

  it("searches by name and by bio", async () => {
    const byName = await request(app).get("/api/educators?search=omar");
    expect(byName.body.data).toHaveLength(1);
    expect(byName.body.data[0]._id).toBe(userId2.toString());

    const byBio = await request(app).get("/api/educators?search=tafsir");
    expect(byBio.body.data).toHaveLength(1);
    expect(byBio.body.data[0]._id).toBe(userId3.toString());
  });

  it("skips content whose creator was deleted", async () => {
    await Book.deleteMany({ author: userId1 });

    const res = await request(app).get("/api/educators");
    const aisha = res.body.data.find((e) => e._id === userId1.toString());
    expect(aisha.books).toBe(0);
  });

  it("maps system roles to display labels so 'admin' never renders as a job title", async () => {
    await Course.create({
      title: "Internal Course",
      description: "Admin-curated course.",
      category: "Admin",
      createdBy: adminId,
    });

    const res = await request(app).get("/api/educators");
    const admin = res.body.data.find((e) => e._id === adminId.toString());

    expect(admin).toBeDefined();
    expect(admin.role).toBeNull();
  });
});
