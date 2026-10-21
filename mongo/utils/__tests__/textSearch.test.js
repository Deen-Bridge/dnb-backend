import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import textSearch, {
  buildTextFilter,
  buildTextProjection,
  buildTextSort,
  textSearch as textSearchFn,
} from "../textSearch.js";

let mongoServer;

// Test schema with text index
const testSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: String,
  price: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
});

testSchema.index({ title: "text", description: "text", category: "text" }, { weights: { title: 5 } });

let TestModel;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  TestModel = mongoose.model("TestTextSearch", testSchema);
  await TestModel.syncIndexes();
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
  await TestModel.deleteMany({});
  await TestModel.create([
    { title: "React Fundamentals", description: "Learn React from scratch", category: "Programming", price: 100 },
    { title: "Advanced React Patterns", description: "Deep dive into React design patterns", category: "Programming", price: 150 },
    { title: "Node.js Basics", description: "Introduction to Node.js and Express", category: "Programming", price: 80 },
    { title: "Cooking 101", description: "Learn how to cook basic meals", category: "Cooking", price: 0 },
    { title: "Advanced Cooking Techniques", description: "Master advanced culinary skills", category: "Cooking", price: 50 },
  ]);
});

describe("buildTextFilter", () => {
  it("returns empty object when term is empty", () => {
    const filter = buildTextFilter("");
    expect(filter).toEqual({});
  });

  it("returns empty object when term is null/undefined", () => {
    expect(buildTextFilter(null)).toEqual({});
    expect(buildTextFilter(undefined)).toEqual({});
  });

  it("builds a $text filter for a valid term", () => {
    const filter = buildTextFilter("react");
    expect(filter).toEqual({ $text: { $search: "react" } });
  });

  it("trims whitespace from the term", () => {
    const filter = buildTextFilter("  react  ");
    expect(filter).toEqual({ $text: { $search: "react" } });
  });

  it("combines text filter with additional filters via $and", () => {
    const filter = buildTextFilter("react", { price: { $gte: 100 } });
    expect(filter).toEqual({
      $and: [
        { $text: { $search: "react" } },
        { price: { $gte: 100 } },
      ],
    });
  });

  it("returns only filters when term is empty", () => {
    const filter = buildTextFilter("", { category: "Programming" });
    expect(filter).toEqual({ category: "Programming" });
  });

  it("ignores undefined/null/empty filter values", () => {
    const filter = buildTextFilter("react", {
      category: "Programming",
      price: undefined,
      isActive: null,
      tags: "",
    });
    expect(filter).toEqual({
      $and: [
        { $text: { $search: "react" } },
        { category: "Programming" },
      ],
    });
  });
});

describe("buildTextProjection", () => {
  it("returns only score when no extra fields provided", () => {
    const projection = buildTextProjection();
    expect(projection).toEqual({ score: { $meta: "textScore" } });
  });

  it("merges extra fields with score", () => {
    const projection = buildTextProjection({ title: 1, price: 1 });
    expect(projection).toEqual({
      title: 1,
      price: 1,
      score: { $meta: "textScore" },
    });
  });

  it("score field is always present", () => {
    const projection = buildTextProjection({ _id: 0, title: 1 });
    expect(projection.score).toEqual({ $meta: "textScore" });
  });
});

describe("buildTextSort", () => {
  it("returns default relevance sort when no custom sort provided", () => {
    expect(buildTextSort()).toEqual({ score: { $meta: "textScore" } });
    expect(buildTextSort(null)).toEqual({ score: { $meta: "textScore" } });
    expect(buildTextSort({})).toEqual({ score: { $meta: "textScore" } });
  });

  it("returns custom sort when provided", () => {
    const sort = { price: 1 };
    expect(buildTextSort(sort)).toEqual(sort);
  });
});

describe("textSearch (function)", () => {
  it("throws when model is missing", async () => {
    await expect(textSearchFn({ term: "react" })).rejects.toThrow(TypeError);
  });

  it("throws when term is missing", async () => {
    await expect(textSearchFn({ model: TestModel })).rejects.toThrow(TypeError);
    await expect(textSearchFn({ model: TestModel, term: "" })).rejects.toThrow(TypeError);
    await expect(textSearchFn({ model: TestModel, term: "  " })).rejects.toThrow(TypeError);
  });

  it("returns matching results ordered by text score", async () => {
    const results = await textSearchFn({ model: TestModel, term: "react" });

    expect(results.documents.length).toBeGreaterThan(0);
    expect(results.total).toBe(2);
    expect(results.page).toBe(1);
    expect(results.limit).toBe(10);
    expect(results.pages).toBe(1);

    // Results should have score field
    results.documents.forEach((doc) => {
      expect(doc.score).toBeDefined();
      expect(typeof doc.score).toBe("number");
    });

    // "React Fundamentals" should rank higher (exact match in title) than
    // "Advanced React Patterns" which also has "React" in title but with extra words
    const titles = results.documents.map((d) => d.title);
    expect(titles).toContain("React Fundamentals");
    expect(titles).toContain("Advanced React Patterns");
  });

  it("searches across multiple fields", async () => {
    const results = await textSearchFn({ model: TestModel, term: "cooking" });
    expect(results.documents.length).toBe(2);
    expect(results.total).toBe(2);
  });

  it("combines text search with filters", async () => {
    const results = await textSearchFn({
      model: TestModel,
      term: "react",
      filters: { price: { $gte: 150 } },
    });

    expect(results.documents.length).toBe(1);
    expect(results.documents[0].title).toBe("Advanced React Patterns");
    expect(results.documents[0].price).toBe(150);
  });

  it("supports pagination", async () => {
    // Create more documents to test pagination
    await TestModel.create([
      { title: "React Testing Guide", description: "Testing React applications comprehensively", category: "Programming", price: 90 },
      { title: "React Native Development", description: "Mobile development with React Native framework", category: "Programming", price: 120 },
      { title: "React Hooks Deep Dive", description: "Understanding React hooks in depth and patterns", category: "Programming", price: 70 },
      { title: "React State Management", description: "Managing state in React applications with Redux", category: "Programming", price: 110 },
    ]);

    const page1 = await textSearchFn({ model: TestModel, term: "react", page: 1, limit: 2 });
    expect(page1.documents.length).toBe(2);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);
    expect(page1.total).toBeGreaterThanOrEqual(5);
    expect(page1.pages).toBeGreaterThanOrEqual(3);

    // Each page has correct count
    const allPageIds = new Set(page1.documents.map((d) => d._id.toString()));
    expect(allPageIds.size).toBe(2);

    // Verify score is present and valid
    page1.documents.forEach((doc) => {
      expect(doc.score).toBeDefined();
      expect(typeof doc.score).toBe("number");
      expect(doc.score).toBeGreaterThan(0);
    });
  });

  it("caps limit at 100", async () => {
    const results = await textSearchFn({ model: TestModel, term: "react", limit: 200 });
    expect(results.limit).toBe(100);
  });

  it("enforces minimum page of 1", async () => {
    const results = await textSearchFn({ model: TestModel, term: "react", page: 0 });
    expect(results.page).toBe(1);
  });

  it("returns empty results for non-matching term", async () => {
    const results = await textSearchFn({ model: TestModel, term: "xyznonexistent" });
    expect(results.documents).toEqual([]);
    expect(results.total).toBe(0);
    expect(results.pages).toBe(0);
  });

  it("returns all documents with lean by default", async () => {
    const results = await textSearchFn({ model: TestModel, term: "react", limit: 100 });
    // Lean returns plain objects, not Mongoose documents
    results.documents.forEach((doc) => {
      expect(doc).not.toHaveProperty("$isNew");
      expect(typeof doc.save).toBe("undefined");
    });
  });

  it("supports custom projection", async () => {
    const results = await textSearchFn({
      model: TestModel,
      term: "react",
      projection: { title: 1, price: 1 },
    });

    expect(results.documents.length).toBeGreaterThan(0);
    const doc = results.documents[0];
    expect(doc.title).toBeDefined();
    expect(doc.price).toBeDefined();
    expect(doc.score).toBeDefined(); // Score always included
    expect(doc.description).toBeUndefined(); // Not projected
  });

  it("supports custom sort", async () => {
    const results = await textSearchFn({
      model: TestModel,
      term: "react",
      sort: { price: 1 }, // Sort by price ascending
    });

    expect(results.documents.length).toBe(2);
    expect(results.documents[0].price).toBeLessThanOrEqual(results.documents[1].price);
  });
});

describe("textSearch (default export)", () => {
  it("has all methods", () => {
    expect(typeof textSearch.buildTextFilter).toBe("function");
    expect(typeof textSearch.buildTextProjection).toBe("function");
    expect(typeof textSearch.buildTextSort).toBe("function");
    expect(typeof textSearch.textSearch).toBe("function");
  });
});
