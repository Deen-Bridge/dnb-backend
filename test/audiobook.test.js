import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { PassThrough } from "stream";

import app from "../app.js";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import ReadingProgress from "../src/models/ReadingProgress.js";
import cloudinary from "../src/utils/cloudinary.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";

// Realistic magic bytes for file-type detection
const validPdfBytes = Buffer.from("%PDF-1.4\n%EOF\n");
const validImageBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
// MP3 files start with the ID3 tag header
const validMp3Bytes = Buffer.from(
  "ID3\x04\x00\x00\x00\x00\x00\x1dfake-mp3-audio-data"
);
const fakeTextBytes = Buffer.from("this is a fake pdf text file");

describe("Audiobook support (#200)", () => {
  jest.setTimeout(30000);
  let mongoServer;
  let author;
  let authorToken;
  let reader;
  let readerToken;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    // Mock Cloudinary uploads: return a fixed URL + public id + duration for
    // every upload so the real upload flow is exercised without network.
    jest.spyOn(cloudinary.uploader, "upload_stream").mockImplementation((options, cb) => {
      const pass = new PassThrough();
      pass.on("data", () => {}); // Consume data to prevent backpressure
      pass.on("end", () =>
        cb(null, {
          secure_url: "https://example.com/uploaded-file",
          public_id: "mock_public_id",
          duration: options.resource_type === "video" ? 3660 : undefined,
        })
      );
      return pass;
    });
    jest.spyOn(cloudinary.utils, "private_download_url").mockImplementation(() => {
      return "https://example.com/signed-audio-url";
    });

    const { token: aToken, user: authorUser } = await seedUserAndLogin(app, {
      name: "Audio Author",
      email: "audio-author@example.com",
      role: "mentor",
      verifiedEducator: true,
    });
    authorToken = aToken;
    author = authorUser;

    const { token: rToken, user: readerUser } = await seedUserAndLogin(app, {
      name: "Audio Reader",
      email: "audio-reader@example.com",
    });
    readerToken = rToken;
    reader = readerUser;
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    // NOTE: seeded users (author/reader) are intentionally NOT deleted — their
    // login tokens from beforeAll must stay valid across tests.
    await Promise.all([Book.deleteMany({}), ReadingProgress.deleteMany({})]);
  });

  const createBook = async (overrides = {}) =>
    Book.create({
      title: "Audiobook Title",
      author: author._id,
      category: "Test",
      price: 0,
      description: "An audiobook",
      image: "https://example.com/cover.jpg",
      fileUrl: "https://example.com/book.pdf",
      ...overrides,
    });

  it("stores audioFileUrl, audioFilePublicId and duration on the Book model", async () => {
    const book = await createBook({
      audioFileUrl: "https://example.com/audio.mp3",
      audioFilePublicId: "audio_123",
      duration: 3660,
    });

    const stored = await Book.findById(book._id);
    expect(stored.audioFileUrl).toBe("https://example.com/audio.mp3");
    expect(stored.audioFilePublicId).toBe("audio_123");
    expect(stored.duration).toBe(3660);
  });

  it("allows creating a book with an audio file instead of a text file", async () => {
    const res = await request(app)
      .post("/api/books")
      .set("Authorization", `Bearer ${authorToken}`)
      .attach("thumbnail", validImageBytes, "thumb.jpg")
      .attach("audio", validMp3Bytes, "book.mp3")
      .field("title", "Audio Only Book")
      .field("category", "Test")
      .field("price", 10)
      .field("description", "Description");

    expect(res.status).toBe(201);
    expect(res.body.data.audioFileUrl).toBe("https://example.com/uploaded-file");
    expect(res.body.data.audioFilePublicId).toBe("mock_public_id");
    expect(res.body.data.duration).toBe(3660);
    // No text file uploaded -> no fileUrl on the audiobook-only record
    expect(res.body.data.fileUrl).toBeUndefined();
  });

  it("rejects an audio file whose magic bytes are not MP3/M4A", async () => {
    const res = await request(app)
      .post("/api/books")
      .set("Authorization", `Bearer ${authorToken}`)
      .attach("thumbnail", validImageBytes, "thumb.jpg")
      .attach("audio", fakeTextBytes, "book.mp3")
      .field("title", "Fake Audio Book")
      .field("category", "Test")
      .field("price", 10)
      .field("description", "Description");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid audio content/i);
  });

  it("uploads audio to an existing book (owner-only)", async () => {
    const book = await createBook();

    const res = await request(app)
      .put(`/api/books/${book._id}/audio`)
      .set("Authorization", `Bearer ${authorToken}`)
      .attach("audio", validMp3Bytes, "book.mp3");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.audioFileUrl).toBe("https://example.com/uploaded-file");
    expect(res.body.data.duration).toBe(3660);

    const updated = await Book.findById(book._id);
    expect(updated.audioFileUrl).toBe("https://example.com/uploaded-file");
    expect(updated.audioFilePublicId).toBe("mock_public_id");
    expect(updated.duration).toBe(3660);
  });

  it("forbids uploading audio to a book the caller does not own", async () => {
    const book = await createBook();

    const res = await request(app)
      .put(`/api/books/${book._id}/audio`)
      .set("Authorization", `Bearer ${readerToken}`)
      .attach("audio", validMp3Bytes, "book.mp3");

    expect(res.status).toBe(403);
  });

  it("redirects an entitled user to a signed audio URL for streaming", async () => {
    const book = await createBook({
      audioFileUrl: "https://example.com/audio.mp3",
      audioFilePublicId: "audio_public_id",
      duration: 3660,
    });

    const res = await request(app)
      .get(`/api/books/${book._id}/audio`)
      .set("Authorization", `Bearer ${authorToken}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://example.com/signed-audio-url");
  });

  it("blocks unentitled users from streaming paid audiobook audio", async () => {
    const book = await createBook({
      price: 25,
      audioFileUrl: "https://example.com/audio.mp3",
      audioFilePublicId: "audio_public_id",
      duration: 3660,
    });

    const res = await request(app)
      .get(`/api/books/${book._id}/audio`)
      .set("Authorization", `Bearer ${readerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/do not have access/i);
  });

  it("returns 404 when the book has no audio file", async () => {
    const book = await createBook(); // text-only book

    const res = await request(app)
      .get(`/api/books/${book._id}/audio`)
      .set("Authorization", `Bearer ${authorToken}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  it("tracks listening progress and derives percentage from audio position", async () => {
    const book = await createBook({
      audioFileUrl: "https://example.com/audio.mp3",
      duration: 500,
    });

    const update = await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${readerToken}`)
      .send({ audioPositionSeconds: 125, audioDuration: 500 });

    expect(update.status).toBe(200);
    expect(update.body.progress.audioPositionSeconds).toBe(125);
    expect(update.body.progress.audioDuration).toBe(500);
    expect(update.body.progress.percentage).toBe(25);

    // Resume: the last listening position is returned.
    const resume = await request(app)
      .get(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${readerToken}`);

    expect(resume.status).toBe(200);
    expect(resume.body.progress.audioPositionSeconds).toBe(125);
    expect(resume.body.progress.percentage).toBe(25);
  });

  it("exposes audio position on the reading library listing", async () => {
    const book = await createBook({
      audioFileUrl: "https://example.com/audio.mp3",
      duration: 600,
    });

    await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${readerToken}`)
      .send({ audioPositionSeconds: 300, audioDuration: 600 });

    const res = await request(app)
      .get("/api/books/library/progress")
      .set("Authorization", `Bearer ${readerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.library).toHaveLength(1);
    expect(res.body.library[0].audioPositionSeconds).toBe(300);
    expect(res.body.library[0].audioDuration).toBe(600);
    expect(res.body.library[0].percentage).toBe(50);
  });

  it("rejects a negative audio position", async () => {
    const book = await createBook();

    const res = await request(app)
      .put(`/api/books/${book._id}/progress`)
      .set("Authorization", `Bearer ${readerToken}`)
      .send({ audioPositionSeconds: -5, audioDuration: 100 });

    expect(res.status).toBe(400);
  });
});
