import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Reel from "../../../src/models/Reel.js";
import { ReelRepository } from "../ReelRepository.js";

describe("ReelRepository", () => {
  let mongoServer;
  let repo;

  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    repo = new ReelRepository(Reel);
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Reel.deleteMany({});
  });

  /* -------------------------------------------------------------------- */
  /* Helpers                                                              */
  /* -------------------------------------------------------------------- */

  const createReel = (overrides = {}) =>
    Reel.create({
      description: "Test reel description",
      category: "education",
      tags: ["tutorial", "coding"],
      video: "https://example.com/video.mp4",
      createdBy: userId,
      viewCount: 0,
      shareCount: 0,
      likes: [],
      loves: [],
      comments: [],
      ...overrides,
    });

  const createBulkReels = (count, overrides = {}) =>
    Reel.insertMany(
      Array.from({ length: count }, (_, i) => ({
        description: `Reel ${i + 1}`,
        category: i % 2 === 0 ? "education" : "entertainment",
        tags: [`tag${i}`],
        video: `https://example.com/video${i}.mp4`,
        createdBy: i % 3 === 0 ? otherUserId : userId,
        viewCount: i * 10,
        shareCount: i,
        likes: i % 2 === 0 ? [otherUserId] : [],
        loves: i % 3 === 0 ? [userId] : [],
        comments: i % 4 === 0 ? [{ user: userId, text: `Comment ${i}` }] : [],
        ...overrides,
      }))
    );

  /* -------------------------------------------------------------------- */
  /* Construction                                                         */
  /* -------------------------------------------------------------------- */

  describe("constructor", () => {
    it("creates an instance extending BaseRepository", () => {
      expect(repo).toBeInstanceOf(ReelRepository);
      expect(repo.model).toBe(Reel);
    });

    it("accepts a custom model for testing", () => {
      const custom = new ReelRepository(Reel);
      expect(custom.model).toBe(Reel);
    });
  });

  /* -------------------------------------------------------------------- */
  /* findByCreator                                                         */
  /* -------------------------------------------------------------------- */

  describe("findByCreator", () => {
    it("returns only reels created by the specified user", async () => {
      await createBulkReels(5);

      const results = await repo.findByCreator(userId);
      expect(results.length).toBeGreaterThan(0);
      for (const doc of results) {
        expect(doc.createdBy.toString()).toBe(userId.toString());
      }
    });

    it("excludes reels from other creators", async () => {
      await createReel({ createdBy: userId });
      await createReel({ createdBy: otherUserId });

      const results = await repo.findByCreator(userId);
      expect(results).toHaveLength(1);
    });

    it("sorts newest first by default", async () => {
      const old = await createReel({ description: "Old" });
      await new Promise((r) => setTimeout(r, 10));
      const newer = await createReel({ description: "Newer" });

      const results = await repo.findByCreator(userId);
      expect(results[0].description).toBe("Newer");
      expect(results[1].description).toBe("Old");
    });

    it("supports additional filter criteria", async () => {
      await createReel({ createdBy: userId, category: "education" });
      await createReel({ createdBy: userId, category: "entertainment" });

      const results = await repo.findByCreator(userId, {
        filter: { category: "education" },
      });
      expect(results).toHaveLength(1);
      expect(results[0].category).toBe("education");
    });

    it("supports limit option", async () => {
      await createBulkReels(5);

      const results = await repo.findByCreator(userId, { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("supports paginated mode", async () => {
      await createBulkReels(5);

      const page1 = await repo.findByCreator(userId, {
        paginate: true,
        limit: 2,
        page: 1,
      });
      expect(page1.data).toHaveLength(2);
      expect(page1.total).toBeGreaterThan(0);
      expect(page1.totalPages).toBeGreaterThan(0);
      expect(page1.hasNextPage).toBeDefined();
      expect(page1.hasPrevPage).toBeDefined();
    });

    it("throws when creatorId is missing", async () => {
      await expect(repo.findByCreator(null)).rejects.toThrow("creatorId");
      await expect(repo.findByCreator(undefined)).rejects.toThrow("creatorId");
      await expect(repo.findByCreator("")).rejects.toThrow("creatorId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* findBySpace                                                           */
  /* -------------------------------------------------------------------- */

  describe("findBySpace", () => {
    it("returns empty array when schema has no spaceId field", async () => {
      await createBulkReels(3);

      const results = await repo.findBySpace(new mongoose.Types.ObjectId());
      expect(results).toEqual([]);
    });

    it("supports paginated mode with empty results", async () => {
      const page = await repo.findBySpace(new mongoose.Types.ObjectId(), {
        paginate: true,
        limit: 10,
      });
      expect(page.data).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.totalPages).toBe(0);
      expect(page.hasNextPage).toBe(false);
      expect(page.hasPrevPage).toBe(false);
    });

    it("throws when spaceId is missing", async () => {
      await expect(repo.findBySpace(null)).rejects.toThrow("spaceId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* findTrending                                                          */
  /* -------------------------------------------------------------------- */

  describe("findTrending", () => {
    it("returns reels sorted by engagement score", async () => {
      const highEngagement = await createReel({
        description: "High engagement",
        viewCount: 1000,
        likes: [userId, otherUserId],
        loves: [userId],
        comments: [{ user: userId, text: "Great!" }],
      });

      const lowEngagement = await createReel({
        description: "Low engagement",
        viewCount: 10,
        likes: [],
        loves: [],
        comments: [],
      });

      const results = await repo.findTrending({ limit: 10 });
      expect(results).toHaveLength(2);
      expect(results[0].description).toBe("High engagement");
      expect(results[1].description).toBe("Low engagement");
    });

    it("respects the limit parameter", async () => {
      await createBulkReels(5);

      const results = await repo.findTrending({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("respects the days parameter", async () => {
      // Create old reel
      const oldReel = await Reel.create({
        description: "Old reel",
        video: "https://example.com/old.mp4",
        createdBy: userId,
        viewCount: 10000,
        createdAt: new Date("2020-01-01"),
      });

      // Create new reel
      const newReel = await createReel({
        description: "New reel",
        viewCount: 10,
      });

      const results = await repo.findTrending({ days: 30 });
      expect(results.some((r) => r.description === "Old reel")).toBe(false);
    });

    it("supports additional filter criteria", async () => {
      await createReel({
        description: "Education reel",
        category: "education",
        viewCount: 100,
      });
      await createReel({
        description: "Entertainment reel",
        category: "entertainment",
        viewCount: 200,
      });

      const results = await repo.findTrending({
        filter: { category: "education" },
      });
      expect(results).toHaveLength(1);
      expect(results[0].category).toBe("education");
    });
  });

  /* -------------------------------------------------------------------- */
  /* incrementViewCount                                                    */
  /* -------------------------------------------------------------------- */

  describe("incrementViewCount", () => {
    it("atomically increments view count", async () => {
      const reel = await createReel({ viewCount: 10 });

      const updated = await repo.incrementViewCount(reel._id);
      expect(updated.viewCount).toBe(11);
    });

    it("increments by specified amount", async () => {
      const reel = await createReel({ viewCount: 10 });

      const updated = await repo.incrementViewCount(reel._id, 5);
      expect(updated.viewCount).toBe(15);
    });

    it("handles concurrent increments correctly", async () => {
      const reel = await createReel({ viewCount: 0 });

      // Fire 10 concurrent increments
      const increments = Array.from({ length: 10 }, () =>
        repo.incrementViewCount(reel._id, 1)
      );
      await Promise.all(increments);

      const updated = await Reel.findById(reel._id);
      expect(updated.viewCount).toBe(10);
    });

    it("returns null for non-existent reel", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const result = await repo.incrementViewCount(fakeId);
      expect(result).toBeNull();
    });

    it("throws when reelId is missing", async () => {
      await expect(repo.incrementViewCount(null)).rejects.toThrow("reelId");
    });

    it("throws when amount is not a number", async () => {
      const reel = await createReel();
      await expect(repo.incrementViewCount(reel._id, "not-a-number")).rejects.toThrow(
        "amount"
      );
    });
  });

  /* -------------------------------------------------------------------- */
  /* addLike                                                               */
  /* -------------------------------------------------------------------- */

  describe("addLike", () => {
    it("adds a user to the likes array", async () => {
      const reel = await createReel();

      const updated = await repo.addLike(reel._id, userId);
      expect(updated.likes.map((id) => id.toString())).toContain(
        userId.toString()
      );
    });

    it("removes user from loves when adding like", async () => {
      const reel = await createReel({ loves: [userId] });

      const updated = await repo.addLike(reel._id, userId);
      expect(updated.likes.map((id) => id.toString())).toContain(
        userId.toString()
      );
      expect(updated.loves.map((id) => id.toString())).not.toContain(
        userId.toString()
      );
    });

    it("does not duplicate likes", async () => {
      const reel = await createReel({ likes: [userId] });

      const updated = await repo.addLike(reel._id, userId);
      const likeCount = updated.likes.filter(
        (id) => id.toString() === userId.toString()
      ).length;
      expect(likeCount).toBe(1);
    });

    it("throws when reelId is missing", async () => {
      await expect(repo.addLike(null, userId)).rejects.toThrow("reelId");
    });

    it("throws when userId is missing", async () => {
      const reel = await createReel();
      await expect(repo.addLike(reel._id, null)).rejects.toThrow("userId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* removeLike                                                            */
  /* -------------------------------------------------------------------- */

  describe("removeLike", () => {
    it("removes a user from the likes array", async () => {
      const reel = await createReel({ likes: [userId] });

      const updated = await repo.removeLike(reel._id, userId);
      expect(updated.likes.map((id) => id.toString())).not.toContain(
        userId.toString()
      );
    });

    it("throws when reelId is missing", async () => {
      await expect(repo.removeLike(null, userId)).rejects.toThrow("reelId");
    });

    it("throws when userId is missing", async () => {
      const reel = await createReel();
      await expect(repo.removeLike(reel._id, null)).rejects.toThrow("userId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* addLove                                                               */
  /* -------------------------------------------------------------------- */

  describe("addLove", () => {
    it("adds a user to the loves array", async () => {
      const reel = await createReel();

      const updated = await repo.addLove(reel._id, userId);
      expect(updated.loves.map((id) => id.toString())).toContain(
        userId.toString()
      );
    });

    it("removes user from likes when adding love", async () => {
      const reel = await createReel({ likes: [userId] });

      const updated = await repo.addLove(reel._id, userId);
      expect(updated.loves.map((id) => id.toString())).toContain(
        userId.toString()
      );
      expect(updated.likes.map((id) => id.toString())).not.toContain(
        userId.toString()
      );
    });

    it("does not duplicate loves", async () => {
      const reel = await createReel({ loves: [userId] });

      const updated = await repo.addLove(reel._id, userId);
      const loveCount = updated.loves.filter(
        (id) => id.toString() === userId.toString()
      ).length;
      expect(loveCount).toBe(1);
    });

    it("throws when reelId is missing", async () => {
      await expect(repo.addLove(null, userId)).rejects.toThrow("reelId");
    });

    it("throws when userId is missing", async () => {
      const reel = await createReel();
      await expect(repo.addLove(reel._id, null)).rejects.toThrow("userId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* removeLove                                                            */
  /* -------------------------------------------------------------------- */

  describe("removeLove", () => {
    it("removes a user from the loves array", async () => {
      const reel = await createReel({ loves: [userId] });

      const updated = await repo.removeLove(reel._id, userId);
      expect(updated.loves.map((id) => id.toString())).not.toContain(
        userId.toString()
      );
    });

    it("throws when reelId is missing", async () => {
      await expect(repo.removeLove(null, userId)).rejects.toThrow("reelId");
    });

    it("throws when userId is missing", async () => {
      const reel = await createReel();
      await expect(repo.removeLove(reel._id, null)).rejects.toThrow("userId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* addComment                                                            */
  /* -------------------------------------------------------------------- */

  describe("addComment", () => {
    it("adds a comment to the reel", async () => {
      const reel = await createReel();

      const updated = await repo.addComment(reel._id, {
        user: userId,
        text: "Great reel!",
      });
      expect(updated.comments).toHaveLength(1);
      expect(updated.comments[0].text).toBe("Great reel!");
      expect(updated.comments[0].user.toString()).toBe(userId.toString());
    });

    it("throws when reelId is missing", async () => {
      await expect(
        repo.addComment(null, { user: userId, text: "test" })
      ).rejects.toThrow("reelId");
    });

    it("throws when comment.user is missing", async () => {
      const reel = await createReel();
      await expect(
        repo.addComment(reel._id, { text: "test" })
      ).rejects.toThrow("comment.user");
    });

    it("throws when comment.text is missing", async () => {
      const reel = await createReel();
      await expect(
        repo.addComment(reel._id, { user: userId })
      ).rejects.toThrow("comment.text");
    });
  });

  /* -------------------------------------------------------------------- */
  /* removeComment                                                         */
  /* -------------------------------------------------------------------- */

  describe("removeComment", () => {
    it("removes a comment from the reel", async () => {
      const reel = await createReel({
        comments: [{ user: userId, text: "To be removed" }],
      });
      const commentId = reel.comments[0]._id;

      const updated = await repo.removeComment(reel._id, commentId);
      expect(updated.comments).toHaveLength(0);
    });

    it("throws when reelId is missing", async () => {
      const fakeCommentId = new mongoose.Types.ObjectId();
      await expect(repo.removeComment(null, fakeCommentId)).rejects.toThrow(
        "reelId"
      );
    });

    it("throws when commentId is missing", async () => {
      const reel = await createReel();
      await expect(repo.removeComment(reel._id, null)).rejects.toThrow(
        "commentId"
      );
    });
  });

  /* -------------------------------------------------------------------- */
  /* incrementShareCount                                                   */
  /* -------------------------------------------------------------------- */

  describe("incrementShareCount", () => {
    it("atomically increments share count", async () => {
      const reel = await createReel({ shareCount: 5 });

      const updated = await repo.incrementShareCount(reel._id);
      expect(updated.shareCount).toBe(6);
    });

    it("increments by specified amount", async () => {
      const reel = await createReel({ shareCount: 5 });

      const updated = await repo.incrementShareCount(reel._id, 3);
      expect(updated.shareCount).toBe(8);
    });

    it("returns null for non-existent reel", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const result = await repo.incrementShareCount(fakeId);
      expect(result).toBeNull();
    });

    it("throws when reelId is missing", async () => {
      await expect(repo.incrementShareCount(null)).rejects.toThrow("reelId");
    });

    it("throws when amount is not a number", async () => {
      const reel = await createReel();
      await expect(repo.incrementShareCount(reel._id, "not-a-number")).rejects.toThrow(
        "amount"
      );
    });
  });

  /* -------------------------------------------------------------------- */
  /* filter                                                                 */
  /* -------------------------------------------------------------------- */

  describe("filter", () => {
    it("filters by creator", async () => {
      await createReel({ createdBy: userId, description: "My reel" });
      await createReel({ createdBy: otherUserId, description: "Other reel" });

      const results = await repo.filter({ creator: userId });
      expect(results).toHaveLength(1);
      expect(results[0].createdBy.toString()).toBe(userId.toString());
    });

    it("filters by category", async () => {
      await createReel({ category: "education" });
      await createReel({ category: "entertainment" });

      const results = await repo.filter({ category: "education" });
      expect(results).toHaveLength(1);
      expect(results[0].category).toBe("education");
    });

    it("filters by tags", async () => {
      await createReel({ tags: ["javascript", "tutorial"] });
      await createReel({ tags: ["cooking", "recipe"] });

      const results = await repo.filter({ tags: ["javascript"] });
      expect(results).toHaveLength(1);
      expect(results[0].tags).toContain("javascript");
    });

    it("filters by search text", async () => {
      await createReel({ description: "Learn JavaScript basics" });
      await createReel({ description: "Cooking tutorial" });

      const results = await repo.filter({ search: "JavaScript" });
      expect(results).toHaveLength(1);
      expect(results[0].description).toContain("JavaScript");
    });

    it("supports sort options", async () => {
      await createReel({ description: "Old", createdAt: new Date("2020-01-01") });
      await createReel({ description: "New", createdAt: new Date("2025-01-01") });

      const results = await repo.filter({}, { sortBy: "createdAt", order: "asc" });
      expect(results[0].description).toBe("Old");
      expect(results[1].description).toBe("New");
    });

    it("supports pagination", async () => {
      await createBulkReels(5);

      const page = await repo.filter({}, { paginate: true, limit: 2, page: 1 });
      expect(page.data).toHaveLength(2);
      expect(page.total).toBeGreaterThan(0);
    });

    it("combines multiple filters", async () => {
      await createReel({
        createdBy: userId,
        category: "education",
        tags: ["javascript"],
      });
      await createReel({
        createdBy: userId,
        category: "entertainment",
        tags: ["cooking"],
      });
      await createReel({
        createdBy: otherUserId,
        category: "education",
        tags: ["javascript"],
      });

      const results = await repo.filter({
        creator: userId,
        category: "education",
      });
      expect(results).toHaveLength(1);
      expect(results[0].tags).toContain("javascript");
    });
  });

  /* -------------------------------------------------------------------- */
  /* Inherited BaseRepository methods                                      */
  /* -------------------------------------------------------------------- */

  describe("inherited BaseRepository methods", () => {
    it("findById returns a reel by id", async () => {
      const reel = await createReel();
      const found = await repo.findById(reel._id);
      expect(found).toBeDefined();
      expect(found._id.toString()).toBe(reel._id.toString());
    });

    it("findOne returns a single reel matching filter", async () => {
      await createReel({ description: "Unique reel" });
      const found = await repo.findOne({ description: "Unique reel" });
      expect(found).toBeDefined();
      expect(found.description).toBe("Unique reel");
    });

    it("findMany returns multiple reels", async () => {
      await createBulkReels(3);
      const results = await repo.findMany({});
      expect(results).toHaveLength(3);
    });

    it("count returns correct count", async () => {
      await createBulkReels(5);
      const count = await repo.count({});
      expect(count).toBe(5);
    });

    it("paginate returns paginated results", async () => {
      await createBulkReels(10);
      const page = await repo.paginate({}, { page: 1, limit: 3 });
      expect(page.data).toHaveLength(3);
      expect(page.total).toBe(10);
      expect(page.totalPages).toBe(4);
      expect(page.hasNextPage).toBe(true);
      expect(page.hasPrevPage).toBe(false);
    });
  });
});
