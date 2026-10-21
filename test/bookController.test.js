import { jest } from "@jest/globals";

// Controller-level tests: handlers are invoked directly with mocked models,
// Cloudinary and services (no DB, Redis or network).
//
// NOTE: the book domain currently has no approval queue (submit / approve /
// reject / list pending) and no generic "update book" endpoint; the only
// update path is PUT /:id/audio (uploadBookAudio). Those are covered here;
// the approval-queue flow cannot be tested until it exists in src/.

const VALID_OID = "507f1f77bcf86cd799439011";
const OWNER_ID = "507f1f77bcf86cd799439012";

const Book = {
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findByIdAndDelete: jest.fn(),
  countDocuments: jest.fn(),
};
const User = { findById: jest.fn() };
const cloudinary = {
  uploader: { upload_stream: jest.fn() },
  utils: { private_download_url: jest.fn() },
};
const validateMagicBytes = jest.fn();
const contentMetricsService = { recordBookView: jest.fn() };
const bookService = {
  uploadAudio: jest.fn(),
  attachAudio: jest.fn(),
  getSignedAudioUrl: jest.fn(),
};
const createNewBookNotification = jest.fn();
const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };

jest.unstable_mockModule("../src/models/Book.js", () => ({ default: Book }));
jest.unstable_mockModule("../src/models/User.js", () => ({ default: User }));
jest.unstable_mockModule("../src/utils/cloudinary.js", () => ({ default: cloudinary }));
jest.unstable_mockModule("../src/config/logger.js", () => ({ default: logger }));
jest.unstable_mockModule("../src/utils/fileValidation.js", () => ({ validateMagicBytes }));
jest.unstable_mockModule("../src/services/analytics/contentMetricsService.js", () => ({
  default: contentMetricsService,
}));
jest.unstable_mockModule("../src/services/book.service.js", () => ({ bookService }));
jest.unstable_mockModule("../src/controllers/notificationController.js", () => ({
  createNewBookNotification,
}));
jest.unstable_mockModule("../src/controllers/reviewController.js", () => ({
  addBookReview: jest.fn(),
  getBookReviews: jest.fn(),
  updateBookReview: jest.fn(),
  deleteBookReview: jest.fn(),
}));

const {
  createBook,
  getBooks,
  getBook,
  getBooksByAuthor,
  deleteBook,
  uploadBookAudio,
  streamBookPreview,
} = await import("../src/controllers/books/bookController.js");

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  return res;
};

// Chainable query stub resolving to `result` at the end of the chain.
const query = (result) => {
  const q = {};
  for (const m of ["select", "sort", "skip", "limit", "populate"]) {
    q[m] = jest.fn().mockReturnValue(q);
  }
  q.lean = jest.fn().mockResolvedValue(result);
  q.then = (res, rej) => Promise.resolve(result).then(res, rej);
  return q;
};

// catchAsync does not return its promise, so wait for the handler to finish.
const settle = async (ret, res, next) => {
  await ret;
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return { res, next };
};

const user = { _id: OWNER_ID, name: "Author", role: "mentor" };

const files = (extra = {}) => ({
  thumbnail: [{ buffer: Buffer.from("img") }],
  file: [{ buffer: Buffer.from("pdf") }],
  ...extra,
});

beforeEach(() => {
  jest.resetAllMocks();
  createNewBookNotification.mockResolvedValue();
  contentMetricsService.recordBookView.mockResolvedValue();
  validateMagicBytes.mockResolvedValue(true);
  cloudinary.uploader.upload_stream.mockImplementation((opts, cb) => ({
    end: () => cb(null, { secure_url: "https://cdn/x", public_id: "pid" }),
  }));
});

describe("createBook", () => {
  const body = { title: "T", category: "History", price: 5, description: "D" };

  it("creates a book and returns 201", async () => {
    Book.create.mockResolvedValue({ _id: VALID_OID, title: "T" });
    const res = mockRes();
    await createBook({ body, files: files(), user }, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(Book.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "T",
        author: OWNER_ID,
        fileUrl: "https://cdn/x",
        filePublicId: "pid",
      })
    );
    expect(createNewBookNotification).toHaveBeenCalled();
  });

  it("returns 400 when thumbnail or book file is missing", async () => {
    const res = mockRes();
    await createBook({ body, files: { thumbnail: files().thumbnail }, user }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Book.create).not.toHaveBeenCalled();
  });

  it("returns 401 when the user is missing", async () => {
    const res = mockRes();
    await createBook({ body, files: files() }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when magic bytes validation fails", async () => {
    validateMagicBytes.mockResolvedValue(false);
    const res = mockRes();
    await createBook({ body, files: files(), user }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
  });

  it("returns 400 when audio upload fails", async () => {
    bookService.uploadAudio.mockRejectedValue(new Error("bad audio"));
    const res = mockRes();
    await createBook(
      { body, files: files({ audio: [{ buffer: Buffer.from("a") }] }), user },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "bad audio" })
    );
  });

  it("returns 500 when the Cloudinary upload errors", async () => {
    cloudinary.uploader.upload_stream.mockImplementation((opts, cb) => ({
      end: () => cb(new Error("cloudinary down")),
    }));
    const res = mockRes();
    await createBook({ body, files: files(), user }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(Book.create).not.toHaveBeenCalled();
  });
});

describe("getBooks / getBook / getBooksByAuthor", () => {
  it("lists books without pagination", async () => {
    Book.find.mockReturnValue(query([{ title: "A" }]));
    const res = mockRes();
    await getBooks({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ title: "A" }] });
  });

  it("filters by category and paginates with clamped limit", async () => {
    Book.find.mockReturnValue(query([{ title: "A" }]));
    Book.countDocuments.mockResolvedValue(5);
    const res = mockRes();
    await getBooks({ query: { category: "History", page: "2", limit: "500" } }, res);
    expect(Book.find).toHaveBeenCalledWith({
      category: "History",
      status: { $ne: "taken-down" },
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 100, total: 5, hasMore: false })
    );
  });

  it("returns 500 when listing fails", async () => {
    Book.find.mockImplementation(() => {
      throw new Error("db");
    });
    const res = mockRes();
    await getBooks({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns a single book and records a view", async () => {
    Book.findById.mockReturnValue(query({ _id: VALID_OID, title: "A" }));
    const res = mockRes();
    await getBook({ params: { id: VALID_OID } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(contentMetricsService.recordBookView).toHaveBeenCalledWith(VALID_OID);
  });

  it("returns 404 when the book does not exist", async () => {
    Book.findById.mockReturnValue(query(null));
    const res = mockRes();
    await getBook({ params: { id: VALID_OID } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(contentMetricsService.recordBookView).not.toHaveBeenCalled();
  });

  it("returns books by author, and 400 without an author id", async () => {
    Book.find.mockReturnValue(query([{ title: "A" }]));
    const ok = mockRes();
    await getBooksByAuthor({ params: { authorId: OWNER_ID } }, ok);
    expect(Book.find).toHaveBeenCalledWith({
      author: OWNER_ID,
      status: { $ne: "taken-down" },
    });
    expect(ok.status).toHaveBeenCalledWith(200);

    const bad = mockRes();
    await getBooksByAuthor({ params: {} }, bad);
    expect(bad.status).toHaveBeenCalledWith(400);
  });
});

describe("deleteBook", () => {
  const run = (req) => {
    const res = mockRes();
    const next = jest.fn();
    return settle(deleteBook(req, res, next), res, next);
  };

  it("deletes as the owner", async () => {
    Book.findById.mockResolvedValue({ _id: VALID_OID, author: OWNER_ID });
    Book.findByIdAndDelete.mockResolvedValue({});
    const { res } = await run({ params: { id: VALID_OID }, user });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Book.findByIdAndDelete).toHaveBeenCalledWith(VALID_OID);
  });

  it("allows an admin who is not the owner", async () => {
    Book.findById.mockResolvedValue({ _id: VALID_OID, author: OWNER_ID });
    Book.findByIdAndDelete.mockResolvedValue({});
    const { res } = await run({
      params: { id: VALID_OID },
      user: { _id: "507f1f77bcf86cd799439099", role: "admin" },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("400 for an invalid id", async () => {
    const { next } = await run({ params: { id: "nope" }, user });
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });

  it("404 when the book is missing", async () => {
    Book.findById.mockResolvedValue(null);
    const { next } = await run({ params: { id: VALID_OID }, user });
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it("403 for a non-owner non-admin", async () => {
    Book.findById.mockResolvedValue({ _id: VALID_OID, author: OWNER_ID });
    const { next } = await run({
      params: { id: VALID_OID },
      user: { _id: "507f1f77bcf86cd799439099", role: "student" },
    });
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(Book.findByIdAndDelete).not.toHaveBeenCalled();
  });
});

describe("uploadBookAudio (update path)", () => {
  const run = (req) => {
    const res = mockRes();
    const next = jest.fn();
    return settle(uploadBookAudio(req, res, next), res, next);
  };

  it("attaches audio to an existing book", async () => {
    Book.findById.mockResolvedValue({ _id: VALID_OID });
    bookService.uploadAudio.mockResolvedValue({ secureUrl: "u", publicId: "p", duration: 12 });
    bookService.attachAudio.mockResolvedValue({
      _id: VALID_OID,
      title: "T",
      audioFileUrl: "u",
      duration: 12,
    });
    const { res } = await run({
      params: { id: VALID_OID },
      body: {},
      file: { buffer: Buffer.from("a") },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(bookService.attachAudio).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: VALID_OID, audioFileUrl: "u", duration: 12 })
    );
  });

  it("404 when the book is missing", async () => {
    Book.findById.mockResolvedValue(null);
    const { next } = await run({ params: { id: VALID_OID }, body: {} });
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it("400 when no audio file is supplied", async () => {
    Book.findById.mockResolvedValue({ _id: VALID_OID });
    const { next } = await run({ params: { id: VALID_OID }, body: {} });
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(bookService.uploadAudio).not.toHaveBeenCalled();
  });
});

describe("streamBookPreview access control", () => {
  const populated = (book) => ({ populate: jest.fn().mockResolvedValue(book) });

  it("404 when the book or file is missing", async () => {
    Book.findById.mockReturnValue(populated(null));
    const res = mockRes();
    await streamBookPreview({ params: { id: VALID_OID } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("403 for a paid book the user has not purchased", async () => {
    Book.findById.mockReturnValue(
      populated({ price: 10, fileUrl: "f", author: { _id: OWNER_ID } })
    );
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ purchasedBooks: [] }) });
    const res = mockRes();
    await streamBookPreview(
      { params: { id: VALID_OID }, user: { _id: "507f1f77bcf86cd799439099" } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("redirects the author to a signed URL", async () => {
    Book.findById.mockReturnValue(
      populated({ price: 10, fileUrl: "f", filePublicId: "pid", author: { _id: OWNER_ID } })
    );
    cloudinary.utils.private_download_url.mockReturnValue("https://signed");
    const res = mockRes();
    await streamBookPreview({ params: { id: VALID_OID }, user }, res);
    expect(res.redirect).toHaveBeenCalledWith(302, "https://signed");
  });
});

describe("approval queue", () => {
  it.todo("submit / approve / reject / list pending: no approval workflow exists for books in src/");
});
