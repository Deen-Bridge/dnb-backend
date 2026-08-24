import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import app from "../app.js";
import Book from "../src/models/Book.js";
import Session from "../src/models/Session.js";
import User from "../src/models/User.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";

describe("Book deletion authorization", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      Book.deleteMany({}),
      Session.deleteMany({}),
      User.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const createBook = (author) =>
    Book.create({
      title: "Protected Book",
      author,
      category: "History",
      description: "A book that only its author may delete",
      image: "https://example.com/book.jpg",
      fileUrl: "https://example.com/book.pdf",
    });

  it("rejects unauthenticated deletion with 401", async () => {
    const book = await createBook(new mongoose.Types.ObjectId());

    const response = await request(app).delete(`/api/books/${book._id}`);

    expect(response.status).toBe(401);
    expect(await Book.exists({ _id: book._id })).not.toBeNull();
  });

  it("rejects deletion by a non-owner with 403", async () => {
    const owner = await User.create({
      name: "Book Owner",
      email: "book.owner@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
      isVerified: true,
    });
    const { token } = await seedUserAndLogin(app, {
      name: "Other User",
      email: "other.book.user@example.com",
    });
    const book = await createBook(owner._id);

    const response = await request(app)
      .delete(`/api/books/${book._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(await Book.exists({ _id: book._id })).not.toBeNull();
  });

  it("allows the author to delete their book", async () => {
    const { token, user } = await seedUserAndLogin(app, {
      name: "Book Owner",
      email: "deleting.owner@example.com",
      role: "mentor",
    });
    const book = await createBook(user._id);

    const response = await request(app)
      .delete(`/api/books/${book._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Book deleted",
      data: null,
    });
    expect(await Book.exists({ _id: book._id })).toBeNull();
  });

  it("returns 404 when the book does not exist", async () => {
    const { token } = await seedUserAndLogin(app, {
      name: "Missing Book Owner",
      email: "missing.book.owner@example.com",
    });

    const response = await request(app)
      .delete(`/api/books/${new mongoose.Types.ObjectId()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Book not found");
  });

  it("returns 400 for an invalid book id", async () => {
    const { token } = await seedUserAndLogin(app, {
      name: "Invalid Book Owner",
      email: "invalid.book.owner@example.com",
    });

    const response = await request(app)
      .delete("/api/books/not-a-book-id")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
  });
});
