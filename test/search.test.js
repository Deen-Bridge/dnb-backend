import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import Course from "../src/models/Course.js";
import Book from "../src/models/Book.js";
import User from "../src/models/User.js";
import Space from "../src/models/Space.js";
import Reel from "../src/models/Reel.js";

beforeAll(async () => {
  await mongoose.connect(`${process.env.MONGO_URI}_search`);
}, 60000);

beforeEach(async () => {
  // Clean db
  await Course.deleteMany({});
  await Book.deleteMany({});
  await User.deleteMany({});
  await Space.deleteMany({});
  await Reel.deleteMany({});

  const userId1 = new mongoose.Types.ObjectId();
  const userId2 = new mongoose.Types.ObjectId();

  await Course.create([
    { title: "React Fundamentals", description: "Learn React from scratch.", category: "Programming", price: 100, createdBy: userId1 },
    { title: "Advanced Node.js", description: "Deep dive into Node and V8.", category: "Programming", price: 150, createdBy: userId1 },
    { title: "Cooking 101", description: "Learn how to cook basic meals.", category: "Cooking", price: 0, createdBy: userId2 }
  ]);

  await Book.create([
    { title: "React Design Patterns", description: "Advanced patterns in React.", category: "Programming", price: 50, author: userId1, image: "url", fileUrl: "url" },
    { title: "Node.js Design Patterns", description: "Node best practices.", category: "Programming", price: 60, author: userId1, image: "url", fileUrl: "url" }
  ]);

  await User.create([
    { _id: userId1, name: "John Doe", email: "john@example.com", password: "password", role: "tutor", bio: "React expert and tutor.", interests: ["React", "JavaScript"] },
    { _id: userId2, name: "Jane Smith", email: "jane@example.com", password: "password", role: "tutor", bio: "Cooking master.", interests: ["Cooking"] },
    { name: "Student Bob", email: "bob@example.com", password: "password", role: "student" }
  ]);
  
  // Wait for indexes to build
  await Course.syncIndexes();
  await Book.syncIndexes();
  await User.syncIndexes();
  await Space.syncIndexes();
  await Reel.syncIndexes();
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});


describe("Full-text search API", () => {
  it("should return relevance ordered results for 'React'", async () => {
    const res = await request(app).get("/api/search?q=React");
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.results.courses).toBeDefined();
    expect(res.body.results.books).toBeDefined();
    // Check if courses returned match the query
    expect(res.body.results.courses.length).toBeGreaterThan(0);
    expect(res.body.results.courses[0].title).toContain("React");
  });

  it("should support pagination per type", async () => {
    const res = await request(app).get("/api/search?q=Node&limit=1");
    expect(res.statusCode).toBe(200);
    expect(res.body.results.courses.length).toBeLessThanOrEqual(1);
    expect(res.body.pagination.courses.limit).toBe(1);
  });

  it("should filter by free", async () => {
    const res = await request(app).get("/api/search?type=courses&free=true");
    expect(res.statusCode).toBe(200);
    expect(res.body.results.courses.length).toBe(1);
    expect(res.body.results.courses[0].title).toBe("Cooking 101");
  });

  it("rejects invalid minRating values", async () => {
    const res = await request(app).get("/api/search?minRating=5.5");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("should filter by category", async () => {
    const res = await request(app).get("/api/search?category=Cooking");
    expect(res.statusCode).toBe(200);
    expect(res.body.results.courses.length).toBe(1);
    expect(res.body.results.books.length).toBe(0);
  });

  it("should support educator search with public fields only", async () => {
    const res = await request(app).get("/api/search/educators?interest=React");
    expect(res.statusCode).toBe(200);
    expect(res.body.results.length).toBe(1);
    expect(res.body.results[0].name).toBe("John Doe");
    expect(res.body.results[0].email).toBeUndefined();
    expect(res.body.results[0].password).toBeUndefined();
  });
});
