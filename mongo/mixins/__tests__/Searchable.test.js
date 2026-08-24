import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { applySearchable } from "../Searchable.js";

let mongoServer;

// Two different schemas to prove the mixin is genuinely reusable
const bookSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: String,
  price: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
});

bookSchema.index({ title: "text", description: "text", category: "text" }, { weights: { title: 5 } });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  bio: { type: String },
  interests: [String],
  role: { type: String, default: "student" },
});

userSchema.index({ name: "text", bio: "text", interests: "text" }, { default_language: "none" });

let BookModel;
let UserModel;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  // Apply mixin before compiling models
  applySearchable(bookSchema, {
    defaultFields: ["title", "description", "category", "price"],
    defaultFilters: { isActive: true },
  });

  applySearchable(userSchema, {
    defaultFields: ["name", "bio", "interests"],
  });

  BookModel = mongoose.model("TestBook", bookSchema);
  UserModel = mongoose.model("TestUser", userSchema);

  await BookModel.syncIndexes();
  await UserModel.syncIndexes();
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
  await BookModel.deleteMany({});
  await UserModel.deleteMany({});

  await BookModel.create([
    { title: "React Fundamentals", description: "Learn React from scratch", category: "Programming", price: 100 },
    { title: "Advanced React Patterns", description: "Deep dive into React design patterns", category: "Programming", price: 150 },
    { title: "Node.js Basics", description: "Introduction to Node.js and Express", category: "Programming", price: 80 },
    { title: "Cooking 101", description: "Learn how to cook basic meals", category: "Cooking", price: 0 },
    { title: "Advanced Cooking Techniques", description: "Master advanced culinary skills", category: "Cooking", price: 50 },
    // Inactive book — should be filtered by default
    { title: "Inactive React Book", description: "This book is inactive", category: "Programming", price: 30, isActive: false },
  ]);

  await UserModel.create([
    { name: "John Doe", bio: "React expert and tutor", interests: ["React", "JavaScript"], role: "mentor" },
    { name: "Jane Smith", bio: "Cooking master", interests: ["Cooking"], role: "mentor" },
    { name: "Bob Student", bio: "Learning React", interests: ["React"], role: "student" },
  ]);
});

describe("applySearchable", () => {
  it("throws when schema is not a Mongoose schema", () => {
    expect(() => applySearchable({})).toThrow(TypeError);
    expect(() => applySearchable(null)).toThrow(TypeError);
  });

  it("adds .search() static method to schema", () => {
    expect(typeof BookModel.search).toBe("function");
    expect(typeof UserModel.search).toBe("function");
  });

  it("adds helper static methods to schema", () => {
    expect(typeof BookModel._buildSearchFilter).toBe("function");
    expect(typeof BookModel._buildSearchProjection).toBe("function");
    expect(typeof BookModel._buildSearchSort).toBe("function");
  });
});

describe("Model.search()", () => {
  it("returns matching results with score", async () => {
    const results = await BookModel.search({ term: "react" });

    expect(results.documents.length).toBe(2); // Inactive book filtered out
    expect(results.total).toBe(2);
    expect(results.page).toBe(1);

    results.documents.forEach((doc) => {
      expect(doc.score).toBeDefined();
      expect(typeof doc.score).toBe("number");
    });
  });

  it("applies default filters", async () => {
    // Without mixin, inactive book would appear
    const results = await BookModel.search({ term: "react" });
    const titles = results.documents.map((d) => d.title);
    expect(titles).not.toContain("Inactive React Book");
  });

  it("combines default filters with caller filters", async () => {
    const results = await BookModel.search({
      term: "react",
      filters: { price: { $gte: 150 } },
    });

    expect(results.documents.length).toBe(1);
    expect(results.documents[0].title).toBe("Advanced React Patterns");
  });

  it("supports pagination", async () => {
    const results = await BookModel.search({ term: "react", page: 1, limit: 1 });
    expect(results.documents.length).toBe(1);
    expect(results.limit).toBe(1);
    expect(results.total).toBe(2);
    expect(results.pages).toBe(2);
  });

  it("returns default fields when configured", async () => {
    const results = await BookModel.search({ term: "react" });
    const doc = results.documents[0];

    // Default fields should be included
    expect(doc.title).toBeDefined();
    expect(doc.description).toBeDefined();
    expect(doc.category).toBeDefined();
    expect(doc.price).toBeDefined();
    expect(doc.score).toBeDefined();

    // Fields not in defaultFields should not be included (unless _id)
    expect(doc.isActive).toBeUndefined();
  });

  it("overrides default fields with explicit projection", async () => {
    const results = await BookModel.search({
      term: "react",
      projection: { title: 1, price: 1 },
    });

    const doc = results.documents[0];
    expect(doc.title).toBeDefined();
    expect(doc.price).toBeDefined();
    expect(doc.score).toBeDefined();
    expect(doc.description).toBeUndefined(); // Not in explicit projection
  });

  it("overrides default filters with empty filters", async () => {
    // When caller passes empty filters, default filters still apply
    const results = await BookModel.search({ term: "react", filters: {} });
    const titles = results.documents.map((d) => d.title);
    expect(titles).not.toContain("Inactive React Book");
  });

  it("works with models without default filters", async () => {
    const results = await UserModel.search({ term: "react" });
    expect(results.documents.length).toBe(2); // John Doe and Bob Student
    const names = results.documents.map((d) => d.name);
    expect(names).toContain("John Doe");
    expect(names).toContain("Bob Student");
  });

  it("returns default fields for models without defaultFields config", async () => {
    const results = await UserModel.search({ term: "react" });
    const doc = results.documents[0];

    // All fields should be present when no defaultFields configured
    expect(doc.name).toBeDefined();
    expect(doc.bio).toBeDefined();
    expect(doc.interests).toBeDefined();
    expect(doc.score).toBeDefined();
  });

  it("returns empty results for non-matching term", async () => {
    const results = await BookModel.search({ term: "xyznonexistent" });
    expect(results.documents).toEqual([]);
    expect(results.total).toBe(0);
    expect(results.pages).toBe(0);
  });

  it("searches across multiple fields", async () => {
    // Search by category (should match "Programming" in category field)
    const results = await BookModel.search({ term: "programming" });
    expect(results.documents.length).toBe(3); // React Fundamentals, Advanced React, Node.js
  });

  it("supports custom sort", async () => {
    const results = await BookModel.search({
      term: "react",
      sort: { price: 1 },
    });

    expect(results.documents.length).toBe(2);
    expect(results.documents[0].price).toBeLessThanOrEqual(results.documents[1].price);
  });
});

describe("Model._buildSearchFilter()", () => {
  it("builds a text filter with term", () => {
    const filter = UserModel._buildSearchFilter("react");
    expect(filter).toEqual({ $text: { $search: "react" } });
  });

  it("includes default filters", () => {
    const filter = BookModel._buildSearchFilter("react", { price: { $gte: 100 } });
    expect(filter).toEqual({
      $and: [
        { $text: { $search: "react" } },
        { isActive: true, price: { $gte: 100 } },
      ],
    });
  });

  it("works for models without default filters", () => {
    const filter = UserModel._buildSearchFilter("react");
    expect(filter).toEqual({ $text: { $search: "react" } });
  });
});

describe("Model._buildSearchProjection()", () => {
  it("includes default fields and score", () => {
    const projection = BookModel._buildSearchProjection();
    expect(projection).toEqual({
      title: 1,
      description: 1,
      category: 1,
      price: 1,
      score: { $meta: "textScore" },
    });
  });

  it("merges with extra projection", () => {
    const projection = BookModel._buildSearchProjection({ rating: 1 });
    expect(projection).toEqual({
      title: 1,
      description: 1,
      category: 1,
      price: 1,
      rating: 1,
      score: { $meta: "textScore" },
    });
  });

  it("returns only score when no defaultFields", () => {
    const projection = UserModel._buildSearchProjection();
    expect(projection).toEqual({
      name: 1,
      bio: 1,
      interests: 1,
      score: { $meta: "textScore" },
    });
  });
});

describe("Model._buildSearchSort()", () => {
  it("returns default relevance sort", () => {
    const sort = BookModel._buildSearchSort();
    expect(sort).toEqual({ score: { $meta: "textScore" } });
  });

  it("returns custom sort when provided", () => {
    const sort = BookModel._buildSearchSort({ price: -1 });
    expect(sort).toEqual({ price: -1 });
  });
});
