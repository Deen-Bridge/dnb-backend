import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app.js";
import Book from "../src/models/Book.js";
import User from "../src/models/User.js";

const JWT_SECRET = process.env.JWT_SECRET;

const bearer = (user, is2FAVerified = true) =>
  `Bearer ${jwt.sign(
    {
      userId: user._id.toString(),
      sessionId: "test-session",
      is2FAVerified,
    },
    JWT_SECRET
  )}`;

const createUser = (overrides = {}) =>
  User.create({
    name: "Test User",
    email: `user-${new mongoose.Types.ObjectId()}@example.com`,
    password: "Qx7#vLmp92Zt",
    role: "student",
    isVerified: true,
    ...overrides,
  });

const createBook = (author, overrides = {}) =>
  Book.create({
    title: "Moderated Book",
    author: author._id,
    category: "Fiqh",
    description: "A book used by the moderation tests",
    image: "https://example.com/book.jpg",
    fileUrl: "https://example.com/book.pdf",
    price: 0,
    ...overrides,
  });

describe("Book take-down and restore controls (#314)", () => {
  let mongoServer;
  let admin;
  let author;
  let student;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 120000);

  beforeEach(async () => {
    await Promise.all([Book.deleteMany({}), User.deleteMany({})]);
    admin = await createUser({
      name: "Catalog Admin",
      role: "admin",
      twoFactor: { enabled: true },
    });
    author = await createUser({ name: "Book Author", role: "mentor" });
    student = await createUser({ name: "Student" });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  it("lets an admin take a book down with a reason category", async () => {
    const book = await createBook(author);

    const response = await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(admin))
      .send({ reason: "dmca", note: "Rights holder notice" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe("taken-down");
    expect(response.body.data.statusBeforeTakedown).toBe("active");
    expect(response.body.data.takenDownReason).toBe("dmca");
    expect(response.body.data.takenDownNote).toBe("Rights holder notice");
    expect(response.body.data.takenDownBy).toBe(admin._id.toString());
    expect(response.body.data.purchaserAccessAllowed).toBe(true);
  });

  it("rejects take-down from non-admins and unknown reasons", async () => {
    const book = await createBook(author);

    const forbidden = await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(student))
      .send({ reason: "dmca" });
    expect(forbidden.status).toBe(403);

    const invalid = await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(admin))
      .send({ reason: "not-a-reason" });
    expect(invalid.status).toBe(400);
  });

  it("hides a taken-down book from the catalog but not from the admin list", async () => {
    const book = await createBook(author);

    await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(admin))
      .send({ reason: "content-violation" });

    const catalog = await request(app).get("/api/books");
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.map((entry) => entry._id)).not.toContain(book._id.toString());

    const adminList = await request(app)
      .get("/api/books/admin")
      .set("Authorization", bearer(admin));
    expect(adminList.status).toBe(200);
    const listed = adminList.body.data.find((entry) => entry._id === book._id.toString());
    expect(listed).toBeDefined();
    expect(listed.status).toBe("taken-down");
    expect(listed.takenDownReason).toBe("content-violation");
  });

  it("keeps the taken-down detail private while allowing admins and the author", async () => {
    const book = await createBook(author);

    await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(admin))
      .send({ reason: "quality-issues" });

    const anonymous = await request(app).get(`/api/books/${book._id}`);
    expect(anonymous.status).toBe(404);

    const adminView = await request(app)
      .get(`/api/books/${book._id}`)
      .set("Authorization", bearer(admin));
    expect(adminView.status).toBe(200);

    const authorView = await request(app)
      .get(`/api/books/${book._id}`)
      .set("Authorization", bearer(author));
    expect(authorView.status).toBe(200);
  });

  it("preserves purchaser access when licensing allows it", async () => {
    const book = await createBook(author, { price: 10 });
    student.purchasedBooks = [{ bookId: book._id }];
    await student.save();

    await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(admin))
      .send({ reason: "dmca", purchaserAccessAllowed: true });

    const detail = await request(app)
      .get(`/api/books/${book._id}`)
      .set("Authorization", bearer(student));
    expect(detail.status).toBe(200);
  });

  it("revokes purchaser reading access when licensing forbids it", async () => {
    const book = await createBook(author, { price: 10 });
    student.purchasedBooks = [{ bookId: book._id }];
    await student.save();

    await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(admin))
      .send({ reason: "dmca", purchaserAccessAllowed: false });

    const detail = await request(app)
      .get(`/api/books/${book._id}`)
      .set("Authorization", bearer(student));
    expect(detail.status).toBe(404);

    const preview = await request(app)
      .get(`/api/books/${book._id}/preview`)
      .set("Authorization", bearer(student));
    expect(preview.status).toBe(403);
  });

  it("blocks reading for non-purchasers while the book is taken down", async () => {
    const book = await createBook(author, { price: 10 });

    await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(admin))
      .send({ reason: "content-violation" });

    const preview = await request(app)
      .get(`/api/books/${book._id}/preview`)
      .set("Authorization", bearer(student));
    expect(preview.status).toBe(403);
  });

  it("restores the book to its prior active state", async () => {
    const book = await createBook(author);

    await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(admin))
      .send({ reason: "other" });

    const restored = await request(app)
      .patch(`/api/books/${book._id}/restore`)
      .set("Authorization", bearer(admin));

    expect(restored.status).toBe(200);
    expect(restored.body.data.status).toBe("active");
    expect(restored.body.data.statusBeforeTakedown).toBe("active");
    expect(restored.body.data.takenDownReason).toBeNull();
    expect(restored.body.data.takenDownAt).toBeNull();
    expect(restored.body.data.takenDownBy).toBeNull();

    const catalog = await request(app).get("/api/books");
    expect(catalog.body.data.map((entry) => entry._id)).toContain(book._id.toString());
  });

  it("returns 409 when taking down or restoring an already-moderated book", async () => {
    const book = await createBook(author);

    await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(admin))
      .send({ reason: "dmca" });

    const secondTakedown = await request(app)
      .patch(`/api/books/${book._id}/take-down`)
      .set("Authorization", bearer(admin))
      .send({ reason: "dmca" });
    expect(secondTakedown.status).toBe(409);

    await request(app)
      .patch(`/api/books/${book._id}/restore`)
      .set("Authorization", bearer(admin));

    const secondRestore = await request(app)
      .patch(`/api/books/${book._id}/restore`)
      .set("Authorization", bearer(admin));
    expect(secondRestore.status).toBe(409);
  });

  it("keeps legacy books without a status field in the public catalog", async () => {
    const book = await createBook(author);
    await Book.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(book._id) },
      { $unset: { status: 1 } }
    );

    const catalog = await request(app).get("/api/books");
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.map((entry) => entry._id)).toContain(book._id.toString());
  });
});
