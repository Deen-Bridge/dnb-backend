import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../app.js";
import Course from "../src/models/Course.js";
import Book from "../src/models/Book.js";
import User from "../src/models/User.js";
import { computeReviewStats } from "../src/utils/reviewStats.js";

const JWT_SECRET = process.env.JWT_SECRET;

const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });
};

import { MongoMemoryServer } from "mongodb-memory-server";

describe("Reviews & Ratings API (Course and Book)", () => {
  let author, enrolledUser, purchaserUser, randomUser, adminUser;
  let authorToken, enrolledToken, purchaserToken, randomToken, adminToken;
  let course, book;
  let mongoServer;

  beforeAll(async () => {
    if (process.env.MONGO_URI && !process.env.MONGO_URI.includes("localhost")) {
      try {
        await mongoose.connect(`${process.env.MONGO_URI}_reviews`);
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

    // Create users
    author = await User.create({
      name: "Author User",
      email: "author@example.com",
      password: "Qx7#vLmp92Zt",
      avatar: "https://example.com/avatar_author.png",
      role: "tutor",
    });
    authorToken = generateToken(author._id);

    enrolledUser = await User.create({
      name: "Enrolled Student",
      email: "enrolled@example.com",
      password: "Qx7#vLmp92Zt",
      avatar: "https://example.com/avatar_enrolled.png",
      role: "student",
    });
    enrolledToken = generateToken(enrolledUser._id);

    purchaserUser = await User.create({
      name: "Purchaser User",
      email: "purchaser@example.com",
      password: "Qx7#vLmp92Zt",
      avatar: "https://example.com/avatar_purchaser.png",
      role: "student",
    });
    purchaserToken = generateToken(purchaserUser._id);

    randomUser = await User.create({
      name: "Random Bystander",
      email: "random@example.com",
      password: "Qx7#vLmp92Zt",
      avatar: "https://example.com/avatar_random.png",
      role: "student",
    });
    randomToken = generateToken(randomUser._id);

    adminUser = await User.create({
      name: "Admin User",
      email: "admin@example.com",
      password: "Qx7#vLmp92Zt",
      avatar: "https://example.com/avatar_admin.png",
      role: "admin",
    });
    adminToken = generateToken(adminUser._id);

    // Create Course
    course = await Course.create({
      title: "Mastering Node.js",
      description: "Learn Node.js in depth",
      category: "Programming",
      price: 50,
      createdBy: author._id,
      enrolledUsers: [enrolledUser._id],
    });

    // Add purchased course to purchaserUser
    purchaserUser.purchasedCourses.push({ courseId: course._id });
    await purchaserUser.save();

    // Create Book
    book = await Book.create({
      title: "Mastering JavaScript",
      description: "Deep dive into JS",
      category: "Programming",
      price: 30,
      author: author._id,
      image: "https://example.com/book.jpg",
      fileUrl: "https://example.com/book.pdf",
    });

    // Add purchased book to purchaserUser
    purchaserUser.purchasedBooks.push({ bookId: book._id });
    await purchaserUser.save();
  });

  describe("Unit: computeReviewStats helper", () => {
    it("computes stats for empty reviews array", () => {
      const stats = computeReviewStats([]);
      expect(stats).toEqual({
        rating: 0,
        numReviews: 0,
        ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      });
    });

    it("computes correct average, numReviews, and breakdown", () => {
      const reviews = [
        { rating: 5 },
        { rating: 4 },
        { rating: 5 },
        { rating: 2 },
      ];
      const stats = computeReviewStats(reviews);
      expect(stats.numReviews).toBe(4);
      expect(stats.rating).toBe(4); // (5+4+5+2)/4 = 4.0
      expect(stats.ratingBreakdown).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 2 });
    });
  });

  describe("Verified-Purchase Gating", () => {
    it("blocks review from a user who has not purchased or enrolled (403)", async () => {
      const res = await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${randomToken}`)
        .send({ rating: 5, comment: "Awesome course!" });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/purchase or enroll/i);
    });

    it("allows course creator / enrolled user / purchaser to review", async () => {
      const resEnrolled = await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${enrolledToken}`)
        .send({ rating: 5, comment: "Great content!" });

      expect(resEnrolled.statusCode).toBe(201);
      expect(resEnrolled.body.success).toBe(true);
      expect(resEnrolled.body.message).toBe("Review added");
      expect(resEnrolled.body.data.reviews).toHaveLength(1);

      const resPurchaser = await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${purchaserToken}`)
        .send({ rating: 4, comment: "Very clear instructions." });

      expect(resPurchaser.statusCode).toBe(201);
      expect(resPurchaser.body.success).toBe(true);
      expect(resPurchaser.body.message).toBe("Review added");
      expect(resPurchaser.body.data.reviews).toHaveLength(2);

      const resAuthor = await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${authorToken}`)
        .send({ rating: 5, comment: "I made this course!" });

      expect(resAuthor.statusCode).toBe(201);
      expect(resAuthor.body.success).toBe(true);
      expect(resAuthor.body.message).toBe("Review added");
      expect(resAuthor.body.data.reviews).toHaveLength(3);
    });

    it("rejects fractional and non-numeric ratings", async () => {
      const fractional = await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${enrolledToken}`)
        .send({ rating: 4.5, comment: "Fractional rating" });
      const nonNumeric = await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${enrolledToken}`)
        .send({ rating: "great", comment: "Non-numeric rating" });

      expect(fractional.statusCode).toBe(400);
      expect(nonNumeric.statusCode).toBe(400);
    });

    it("enforces one review per user rule (400 on duplicate)", async () => {
      await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${enrolledToken}`)
        .send({ rating: 5, comment: "First review" });

      const resDuplicate = await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${enrolledToken}`)
        .send({ rating: 3, comment: "Second review attempt" });

      expect(resDuplicate.statusCode).toBe(400);
      expect(resDuplicate.body.success).toBe(false);
    });
  });

  describe("Aggregate Persistence Across Add, Edit, and Delete", () => {
    it("persists average, numReviews, and ratingBreakdown on Course and Book", async () => {
      // Add review 1: 5 stars
      await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${enrolledToken}`)
        .send({ rating: 5, comment: "Top notch" });

      let dbCourse = await Course.findById(course._id);
      expect(dbCourse.rating).toBe(5);
      expect(dbCourse.numReviews).toBe(1);
      expect(dbCourse.ratingBreakdown["5"]).toBe(1);

      // Add review 2: 3 stars
      await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${purchaserToken}`)
        .send({ rating: 3, comment: "Average" });

      dbCourse = await Course.findById(course._id);
      expect(dbCourse.numReviews).toBe(2);
      expect(dbCourse.rating).toBe(4); // (5+3)/2 = 4.0
      expect(dbCourse.ratingBreakdown["5"]).toBe(1);
      expect(dbCourse.ratingBreakdown["3"]).toBe(1);

      // Edit review 2: change from 3 to 1 star
      await request(app)
        .put(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${purchaserToken}`)
        .send({ rating: 1, comment: "Actually bad" });

      dbCourse = await Course.findById(course._id);
      expect(dbCourse.numReviews).toBe(2);
      expect(dbCourse.rating).toBe(3); // (5+1)/2 = 3.0
      expect(dbCourse.ratingBreakdown["3"]).toBe(0);
      expect(dbCourse.ratingBreakdown["1"]).toBe(1);

      // Delete review 1 (5 stars)
      await request(app)
        .delete(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${enrolledToken}`);

      dbCourse = await Course.findById(course._id);
      expect(dbCourse.numReviews).toBe(1);
      expect(dbCourse.rating).toBe(1);

      // Delete review 2 (last review) -> resets rating & numReviews to 0
      await request(app)
        .delete(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${purchaserToken}`);

      dbCourse = await Course.findById(course._id);
      expect(dbCourse.numReviews).toBe(0);
      expect(dbCourse.rating).toBe(0);
      expect(dbCourse.ratingBreakdown["1"]).toBe(0);
    });

    it("works identically for Books", async () => {
      // Add review to book
      const addRes = await request(app)
        .post(`/api/books/${book._id}/reviews`)
        .set("Authorization", `Bearer ${authorToken}`)
        .send({ rating: 4, comment: "Great book" });

      expect(addRes.statusCode).toBe(201);
      let dbBook = await Book.findById(book._id);
      expect(dbBook.rating).toBe(4);
      expect(dbBook.numReviews).toBe(1);

      // Delete review from book
      const delRes = await request(app)
        .delete(`/api/books/${book._id}/reviews`)
        .set("Authorization", `Bearer ${authorToken}`);

      expect(delRes.statusCode).toBe(200);
      dbBook = await Book.findById(book._id);
      expect(dbBook.rating).toBe(0);
      expect(dbBook.numReviews).toBe(0);
    });
  });

  describe("Edit and Delete Authorization", () => {
    beforeEach(async () => {
      await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${enrolledToken}`)
        .send({ rating: 4, comment: "Nice course" });
    });

    it("rejects edit attempt by non-owner user (403 or 404)", async () => {
      const res = await request(app)
        .put(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${purchaserToken}`)
        .send({ rating: 1, comment: "Hacked!" });

      expect(res.statusCode).toBe(404); // purchaser user hasn't created a review to edit
    });

    it("allows owner to edit their review", async () => {
      const res = await request(app)
        .put(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${enrolledToken}`)
        .send({ rating: 5, comment: "Updated comment: Superb!" });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Review updated successfully");
      expect(res.body.data.review.comment).toBe("Updated comment: Superb!");
      expect(res.body.data.rating).toBe(5);
    });

    it("rejects delete attempt by non-owner non-admin user", async () => {
      const res = await request(app)
        .delete(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${purchaserToken}`);

      expect(res.statusCode).toBe(404);
    });

    it("allows admin user to delete any review by review ID", async () => {
      const updatedCourse = await Course.findById(course._id);
      const reviewId = updatedCourse.reviews[0]._id;

      const res = await request(app)
        .delete(`/api/courses/${course._id}/reviews/${reviewId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Review deleted successfully");

      const dbCourse = await Course.findById(course._id);
      expect(dbCourse.reviews.length).toBe(0);
      expect(dbCourse.rating).toBe(0);
    });
  });

  describe("Paginated Listing GET /api/:itemType/:id/reviews", () => {
    beforeEach(async () => {
      await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${enrolledToken}`)
        .send({ rating: 5, comment: "First review" });

      await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${purchaserToken}`)
        .send({ rating: 2, comment: "Second review" });

      await request(app)
        .post(`/api/courses/${course._id}/reviews`)
        .set("Authorization", `Bearer ${authorToken}`)
        .send({ rating: 4, comment: "Third review" });
    });

    it("returns paginated reviews with total count and summary", async () => {
      const res = await request(app).get(`/api/courses/${course._id}/reviews?page=1&limit=2`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Reviews retrieved successfully");
      expect(res.body.data.summary).toBeDefined();
      expect(res.body.data.summary.numReviews).toBe(3);
      expect(res.body.data.summary.rating).toBe(3.7); // (5+2+4)/3 = 3.666 -> 3.7
      expect(res.body.data.pagination).toEqual({
        total: 3,
        page: 1,
        limit: 2,
        pages: 2,
      });
      expect(res.body.data.reviews.length).toBe(2);
    });

    it("populates only reviewer name and avatar (no sensitive fields)", async () => {
      const res = await request(app).get(`/api/courses/${course._id}/reviews`);

      expect(res.statusCode).toBe(200);
      const firstReviewUser = res.body.data.reviews[0].user;
      expect(firstReviewUser.name).toBeDefined();
      expect(firstReviewUser.avatar).toBeDefined();
      expect(firstReviewUser.email).toBeUndefined();
      expect(firstReviewUser.password).toBeUndefined();
    });

    it("supports sorting by rating", async () => {
      const res = await request(app).get(`/api/courses/${course._id}/reviews?sort=rating`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.reviews[0].rating).toBe(5);
      expect(res.body.data.reviews[1].rating).toBe(4);
      expect(res.body.data.reviews[2].rating).toBe(2);
    });
  });
});
