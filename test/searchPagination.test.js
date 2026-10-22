import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Course from "../src/models/Course.js";
import Book from "../src/models/Book.js";
import User from "../src/models/User.js";
import { searchCollections, searchEducators, encodeCursor, decodeCursor } from "../src/services/search/searchService.js";

const makeKey = (prefix) => {
  const p = prefix.padEnd(55, "0").slice(0, 55).toUpperCase();
  return "G" + p;
};

describe("Cursor-based pagination for search", () => {
  let mongoServer;
  let author;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Course.deleteMany({}),
      Book.deleteMany({}),
      User.deleteMany({}),
    ]);

    author = await User.create({
      name: "Test Author",
      email: "author-pag@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
      stellarWallet: { publicKey: makeKey("AUTHOR") },
    });

    // Create 5 courses
    for (let i = 0; i < 5; i++) {
      await Course.create({
        title: `Pagination Course ${i}`,
        description: `Course number ${i} for pagination testing`,
        price: 10 + i,
        category: "Tech",
        createdBy: author._id,
      });
    }

    // Create 5 books
    for (let i = 0; i < 5; i++) {
      await Book.create({
        title: `Pagination Book ${i}`,
        description: `Book number ${i} for pagination testing`,
        price: 5 + i,
        category: "Tech",
        author: author._id,
        thumbnail: `https://example.com/thumb${i}.jpg`,
        image: `https://example.com/image${i}.jpg`,
        fileUrl: `https://example.com/file${i}.pdf`,
      });
    }
  });

  describe("encodeCursor / decodeCursor", () => {
    it("round-trips an ObjectId through encode/decode", () => {
      const id = new mongoose.Types.ObjectId();
      const cursor = encodeCursor(id);
      expect(typeof cursor).toBe("string");
      expect(cursor.length).toBeGreaterThan(0);

      const decoded = decodeCursor(cursor);
      expect(decoded).toBe(id.toString());
    });

    it("returns null for invalid cursor strings", () => {
      expect(decodeCursor("not-a-valid-cursor!!!")).toBeNull();
      expect(decodeCursor("")).toBeNull();
    });

    it("returns null for non-hex decoded values", () => {
      // Encode a non-hex string
      const cursor = Buffer.from("not-a-hex-id-value!!").toString("base64url");
      expect(decodeCursor(cursor)).toBeNull();
    });
  });

  describe("searchCollections with cursor", () => {
    it("returns cursor-based pagination with limit 2", async () => {
      const result = await searchCollections({
        q: "",
        type: "courses",
        limit: 2,
      });

      expect(result.results.courses).toHaveLength(2);
      expect(result.pagination.courses.has_more).toBe(true);
      expect(result.pagination.courses.next_cursor).toBeTruthy();
      expect(result.pagination.courses.total).toBe(5);
      expect(result.pagination.courses.limit).toBe(2);
      // In cursor mode, page/pages are not present
      expect(result.pagination.courses.page).toBeUndefined();
    });

    it("fetches the next page using cursor", async () => {
      const page1 = await searchCollections({
        q: "",
        type: "courses",
        limit: 2,
      });

      const cursor = page1.pagination.courses.next_cursor;
      expect(cursor).toBeTruthy();

      const page2 = await searchCollections({
        q: "",
        type: "courses",
        limit: 2,
        cursor,
      });

      // Page 2 should have different items
      const page1Ids = page1.results.courses.map((c) => c._id.toString());
      const page2Ids = page2.results.courses.map((c) => c._id.toString());
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);

      // Total should be consistent
      expect(page2.pagination.courses.total).toBe(5);
    });

    it("returns has_more: false on the last page", async () => {
      const result = await searchCollections({
        q: "",
        type: "courses",
        limit: 5,
      });

      expect(result.results.courses).toHaveLength(5);
      expect(result.pagination.courses.has_more).toBe(false);
      expect(result.pagination.courses.next_cursor).toBeNull();
    });

    it("handles empty results", async () => {
      // Delete all courses
      await Course.deleteMany({});

      const result = await searchCollections({
        q: "",
        type: "courses",
        limit: 10,
      });

      expect(result.results.courses).toHaveLength(0);
      expect(result.pagination.courses.has_more).toBe(false);
      expect(result.pagination.courses.next_cursor).toBeNull();
      expect(result.pagination.courses.total).toBe(0);
    });

    it("returns 400 for invalid cursor", async () => {
      await expect(
        searchCollections({
          q: "",
          type: "courses",
          limit: 2,
          cursor: "not-a-valid-cursor!!!",
        })
      ).rejects.toThrow("Invalid cursor");
    });

    it("searches multiple types with cursor", async () => {
      const result = await searchCollections({
        q: "",
        type: "all",
        limit: 2,
      });

      // Both courses and books should have pagination metadata
      expect(result.pagination.courses).toBeDefined();
      expect(result.pagination.books).toBeDefined();
      expect(result.pagination.courses.has_more).toBe(true);
      expect(result.pagination.books.has_more).toBe(true);
    });
  });

  describe("searchEducators with cursor", () => {
    it("returns cursor-based pagination", async () => {
      const result = await searchEducators({
        q: "",
        limit: 2,
      });

      expect(result.results).toHaveLength(1); // Only 1 educator created
      expect(result.pagination.has_more).toBe(false);
      expect(result.pagination.total).toBe(1);
    });
  });

  describe("backward compatibility", () => {
    it("still supports page/limit offset pagination when no cursor", async () => {
      const result = await searchCollections({
        q: "",
        type: "courses",
        page: 1,
        limit: 2,
        sort: "price",
      });

      // With explicit sort, cursor mode is off — offset pagination is used
      expect(result.pagination.courses.page).toBe(1);
      expect(result.pagination.courses.pages).toBe(3);
      expect(result.pagination.courses.limit).toBe(2);
    });
  });
});
