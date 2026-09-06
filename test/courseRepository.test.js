import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Course from "../src/models/Course.js";
// Registering the User schema so the default `createdBy` populate resolves
// (the running app always has it registered).
import "../src/models/User.js";
import { CourseRepository } from "../mongo/repositories/CourseRepository.js";
import { RepositoryValidationError } from "../mongo/base/BaseRepository.js";

describe("CourseRepository", () => {
  let mongoServer;
  let repo;

  const educatorA = new mongoose.Types.ObjectId();
  const educatorB = new mongoose.Types.ObjectId();
  const categoryQuran = new mongoose.Types.ObjectId();
  const categoryFiqh = new mongoose.Types.ObjectId();
  const learner = new mongoose.Types.ObjectId();
  const otherUser = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (process.env.MONGO_URI) {
      try {
        await mongoose.connect(`${process.env.MONGO_URI}_courserepo`, {
          serverSelectionTimeoutMS: 2000,
        });
      } catch (_err) {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());
      }
    } else {
      mongoServer = await MongoMemoryServer.create();
      await mongoose.connect(mongoServer.getUri());
    }
    // Ensure the text index exists so $text search is available.
    await Course.createIndexes();
    repo = new CourseRepository();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Course.deleteMany({});
    await Course.create([
      {
        title: "Tajweed Basics",
        description: "Learn the rules of Quran recitation",
        category: "Quran",
        categoryRef: categoryQuran,
        createdBy: educatorA,
        rating: 4.8,
        enrolledUsers: [learner],
      },
      {
        title: "Advanced Tajweed",
        description: "Deep dive into makharij and sifaat",
        category: "Quran",
        categoryRef: categoryQuran,
        createdBy: educatorA,
        rating: 4.2,
        enrolledUsers: [learner, otherUser],
      },
      {
        title: "Fiqh of Salah",
        description: "Understanding prayer jurisprudence",
        category: "Fiqh",
        categoryRef: categoryFiqh,
        createdBy: educatorB,
        rating: 3.9,
        enrolledUsers: [],
      },
    ]);
  });

  describe("construction", () => {
    it("extends BaseRepository and wraps the Course model", () => {
      expect(repo).toBeInstanceOf(CourseRepository);
      expect(repo.model.modelName).toBe("Course");
    });
  });

  describe("findByEducator", () => {
    it("returns only that educator's courses", async () => {
      const courses = await repo.findByEducator(educatorA, { lean: true });
      expect(courses).toHaveLength(2);
      expect(courses.every((c) => String(c.createdBy) === String(educatorA))).toBe(true);
      expect(courses.map((c) => c.title).sort()).toEqual([
        "Advanced Tajweed",
        "Tajweed Basics",
      ]);
    });

    it("returns an empty array for an educator with no courses", async () => {
      const courses = await repo.findByEducator(new mongoose.Types.ObjectId());
      expect(courses).toEqual([]);
    });

    it("throws a validation error for a malformed id", async () => {
      await expect(repo.findByEducator("not-an-id")).rejects.toBeInstanceOf(
        RepositoryValidationError
      );
    });
  });

  describe("paginateByEducator", () => {
    it("paginates an educator's courses with metadata", async () => {
      const page = await repo.paginateByEducator(educatorA, { page: 1, limit: 1 });
      expect(page.total).toBe(2);
      expect(page.data).toHaveLength(1);
      expect(page.totalPages).toBe(2);
      expect(page.hasNextPage).toBe(true);
    });
  });

  describe("findPublished", () => {
    it("returns the whole catalogue paginated", async () => {
      const page = await repo.findPublished({ page: 1, limit: 10, lean: true });
      expect(page.total).toBe(3);
      expect(page.data).toHaveLength(3);
      expect(page.data.map((c) => c.title).sort()).toEqual([
        "Advanced Tajweed",
        "Fiqh of Salah",
        "Tajweed Basics",
      ]);
    });

    it("honours an extra filter", async () => {
      const page = await repo.findPublished({ filter: { categoryRef: categoryFiqh } });
      expect(page.total).toBe(1);
      expect(page.data[0].title).toBe("Fiqh of Salah");
    });
  });

  describe("searchCourses", () => {
    it("finds courses via full-text search", async () => {
      const page = await repo.searchCourses("makharij", { lean: true });
      expect(page.total).toBe(1);
      expect(page.data[0].title).toBe("Advanced Tajweed");
    });

    it("orders multi-match text results by rating desc", async () => {
      const page = await repo.searchCourses("Tajweed", { lean: true });
      expect(page.total).toBe(2);
      expect(page.data[0].rating).toBeGreaterThanOrEqual(page.data[1].rating);
    });

    it("uses a regex fallback for short tokens", async () => {
      const page = await repo.searchCourses("Fi", { lean: true });
      expect(page.total).toBe(1);
      expect(page.data[0].title).toBe("Fiqh of Salah");
    });

    it("throws on an empty term", async () => {
      await expect(repo.searchCourses("   ")).rejects.toBeInstanceOf(
        RepositoryValidationError
      );
    });
  });

  describe("findByCategory", () => {
    it("returns courses for a category ref", async () => {
      const courses = await repo.findByCategory(categoryQuran, { lean: true });
      expect(courses).toHaveLength(2);
    });
  });

  describe("enrollment queries", () => {
    it("finds every course a user is enrolled in", async () => {
      const courses = await repo.findEnrolledCourses(learner, { lean: true });
      expect(courses).toHaveLength(2);
    });

    it("paginates enrolled courses", async () => {
      const page = await repo.paginateEnrolledCourses(learner, { limit: 1 });
      expect(page.total).toBe(2);
      expect(page.data).toHaveLength(1);
    });

    it("reports enrollment membership", async () => {
      const basics = await Course.findOne({ title: "Tajweed Basics" });
      expect(await repo.isUserEnrolled(basics._id, learner)).toBe(true);
      expect(await repo.isUserEnrolled(basics._id, otherUser)).toBe(false);
    });

    it("counts enrollments for a course", async () => {
      const advanced = await Course.findOne({ title: "Advanced Tajweed" });
      expect(await repo.countEnrollments(advanced._id)).toBe(2);
      const fiqh = await Course.findOne({ title: "Fiqh of Salah" });
      expect(await repo.countEnrollments(fiqh._id)).toBe(0);
    });

    it("validates ids on enrollment checks", async () => {
      await expect(repo.isUserEnrolled("bad", learner)).rejects.toBeInstanceOf(
        RepositoryValidationError
      );
    });
  });
});
