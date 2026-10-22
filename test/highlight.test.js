import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import Highlight from "../src/models/highlight.model.js";
import Note from "../src/models/note.model.js";

const JWT_SECRET = process.env.JWT_SECRET;
const generateToken = (userId, role = "student") => {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "1h" });
};

describe("Highlights & Notes API (#204)", () => {
  let mongoServer;
  let user, author;
  let token;
  let testBook;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
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
    await User.deleteMany({});
    await Book.deleteMany({});
    await Highlight.deleteMany({});
    await Note.deleteMany({});

    user = await User.create({
      name: "Reader User",
      email: "reader@example.com",
      password: "Password123!",
      role: "student",
    });

    author = await User.create({
      name: "Author User",
      email: "author@example.com",
      password: "Password123!",
      role: "mentor",
    });

    token = generateToken(user._id, "student");

    testBook = await Book.create({
      title: "Seerah of the Prophet",
      author: author._id,
      description: "Comprehensive biography",
      category: "Seerah",
      price: 0,
      image: "https://example.com/cover.jpg",
      fileUrl: "https://example.com/book.pdf",
    });
  });

  it("allows reader to select and save text highlights with color options", async () => {
    const res = await request(app)
      .post(`/api/books/${testBook._id}/highlights`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        text: "The Year of the Elephant witnessed remarkable events.",
        color: "green",
        pageNumber: 15,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.highlight.text).toContain("Year of the Elephant");
    expect(res.body.highlight.color).toBe("green");
    expect(res.body.highlight.pageNumber).toBe(15);
  });

  it("allows adding notes to specific passages or pages", async () => {
    const highlightRes = await request(app)
      .post(`/api/books/${testBook._id}/highlights`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        text: "Patience and steadfastness in Makkah.",
        color: "yellow",
        pageNumber: 42,
      });

    const highlightId = highlightRes.body.highlight._id;

    const noteRes = await request(app)
      .post(`/api/books/${testBook._id}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        highlightId,
        content: "Important reflection on perseverance during hardships.",
        pageNumber: 42,
      });

    expect(noteRes.status).toBe(201);
    expect(noteRes.body.success).toBe(true);
    expect(noteRes.body.note.content).toContain("Important reflection");
  });

  it("views all highlights and notes for a book", async () => {
    await request(app)
      .post(`/api/books/${testBook._id}/highlights`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Passage 1", color: "blue" });

    await request(app)
      .post(`/api/books/${testBook._id}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "Note 1" });

    const res = await request(app)
      .get(`/api/books/${testBook._id}/highlights-notes`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.highlights.length).toBe(1);
    expect(res.body.notes.length).toBe(1);
  });

  it("searches through highlights and notes", async () => {
    await request(app)
      .post(`/api/books/${testBook._id}/highlights`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Prophet's migration to Madinah", color: "purple" });

    await request(app)
      .post(`/api/books/${testBook._id}/notes`)
      .set("Authorization", `Bearer ${token}`)
      .send({ content: "Lessons from Hijrah and brotherhood" });

    const searchRes = await request(app)
      .get(`/api/books/${testBook._id}/highlights-notes/search?q=Hijrah`)
      .set("Authorization", `Bearer ${token}`);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.results.notes.length).toBe(1);
  });

  it("exports highlights as text or PDF", async () => {
    await request(app)
      .post(`/api/books/${testBook._id}/highlights`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Key lesson from treaty of Hudaybiyyah", color: "pink", pageNumber: 88 });

    const textExport = await request(app)
      .get(`/api/books/${testBook._id}/highlights/export?format=text`)
      .set("Authorization", `Bearer ${token}`);

    expect(textExport.status).toBe(200);
    expect(textExport.text).toContain("BOOK: Seerah of the Prophet");
    expect(textExport.text).toContain("Key lesson from treaty");

    const pdfExport = await request(app)
      .get(`/api/books/${testBook._id}/highlights/export?format=pdf`)
      .set("Authorization", `Bearer ${token}`);

    expect(pdfExport.status).toBe(200);
    expect(pdfExport.header["content-type"]).toContain("application/pdf");
  });
});
