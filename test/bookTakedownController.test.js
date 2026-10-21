import { jest } from "@jest/globals";

// Controller-level coverage for the take-down/restore flow. Uses mocked models
// so it runs without a database; the route-level behavior is exercised by
// bookTakedownRestore.test.js.

const BOOK_ID = "507f1f77bcf86cd799439011";
const AUTHOR_ID = "507f1f77bcf86cd799439012";
const ADMIN_ID = "507f1f77bcf86cd799439013";
const STUDENT_ID = "507f1f77bcf86cd799439014";

const Book = {
  find: jest.fn(),
  findById: jest.fn(),
  countDocuments: jest.fn(),
};
const User = { findById: jest.fn() };
const recordAudit = jest.fn();

jest.unstable_mockModule("../src/models/Book.js", () => ({ default: Book }));
jest.unstable_mockModule("../src/models/User.js", () => ({ default: User }));
jest.unstable_mockModule("../src/services/audit/auditService.js", () => ({
  recordAudit,
}));
jest.unstable_mockModule("../src/utils/cloudinary.js", () => ({
  default: { uploader: {}, utils: { private_download_url: jest.fn() } },
}));
jest.unstable_mockModule("../src/config/logger.js", () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule("../src/utils/fileValidation.js", () => ({
  validateMagicBytes: jest.fn(),
}));
jest.unstable_mockModule(
  "../src/services/analytics/contentMetricsService.js",
  () => ({ default: { recordBookView: jest.fn().mockResolvedValue(undefined) } })
);
jest.unstable_mockModule("../src/services/book.service.js", () => ({
  bookService: {},
}));
jest.unstable_mockModule("../src/controllers/notificationController.js", () => ({
  createNewBookNotification: jest.fn(),
}));
jest.unstable_mockModule("../src/controllers/reviewController.js", () => ({
  addBookReview: jest.fn(),
  getBookReviews: jest.fn(),
  updateBookReview: jest.fn(),
  deleteBookReview: jest.fn(),
}));

const {
  getAdminBooks,
  getBook,
  getBooks,
  restoreBook,
  streamBookPreview,
  takeDownBook,
} = await import("../src/controllers/books/bookController.js");

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.getHeader = jest.fn().mockReturnValue("");
  return res;
};

const query = (result) => {
  const q = {};
  for (const method of ["select", "sort", "skip", "limit", "populate"]) {
    q[method] = jest.fn().mockReturnValue(q);
  }
  q.lean = jest.fn().mockResolvedValue(result);
  q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return q;
};

const settle = async (ret, res, next) => {
  await ret;
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { res, next };
};

const fakeBook = (overrides = {}) => ({
  _id: BOOK_ID,
  title: "Moderated Book",
  author: AUTHOR_ID,
  price: 10,
  fileUrl: "https://example.com/book.pdf",
  status: "active",
  statusBeforeTakedown: "active",
  takenDownReason: null,
  takenDownNote: null,
  takenDownAt: null,
  takenDownBy: null,
  purchaserAccessAllowed: true,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const admin = { _id: ADMIN_ID, role: "admin" };
const author = { _id: AUTHOR_ID, role: "mentor" };
const student = { _id: STUDENT_ID, role: "student" };

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockReturnValue(query({ purchasedBooks: [] }));
});

describe("takeDownBook", () => {
  it("records the reason and moderation metadata", async () => {
    const book = fakeBook();
    Book.findById.mockResolvedValue(book);
    const res = mockRes();

    await settle(
      takeDownBook(
        {
          params: { id: BOOK_ID },
          body: { reason: "dmca", note: "Rights notice" },
          user: admin,
        },
        res,
        jest.fn()
      ),
      res,
      jest.fn()
    );

    expect(book.status).toBe("taken-down");
    expect(book.statusBeforeTakedown).toBe("active");
    expect(book.takenDownReason).toBe("dmca");
    expect(book.takenDownNote).toBe("Rights notice");
    expect(book.takenDownBy).toBe(ADMIN_ID);
    expect(book.save).toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "book.takedown",
        targetId: BOOK_ID,
        status: "success",
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("honors an explicit purchaser-access policy", async () => {
    const book = fakeBook();
    Book.findById.mockResolvedValue(book);
    const res = mockRes();

    await settle(
      takeDownBook(
        {
          params: { id: BOOK_ID },
          body: { reason: "dmca", purchaserAccessAllowed: false },
          user: admin,
        },
        res,
        jest.fn()
      ),
      res,
      jest.fn()
    );

    expect(book.purchaserAccessAllowed).toBe(false);
  });

  it("rejects an unknown reason", async () => {
    const next = jest.fn();
    const res = mockRes();
    await settle(
      takeDownBook(
        { params: { id: BOOK_ID }, body: { reason: "nope" }, user: admin },
        res,
        next
      ),
      res,
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(Book.findById).not.toHaveBeenCalled();
  });

  it("returns 409 for an already taken-down book", async () => {
    Book.findById.mockResolvedValue(fakeBook({ status: "taken-down" }));
    const next = jest.fn();
    const res = mockRes();
    await settle(
      takeDownBook(
        { params: { id: BOOK_ID }, body: { reason: "dmca" }, user: admin },
        res,
        next
      ),
      res,
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  });
});

describe("restoreBook", () => {
  it("returns the book to its prior state and clears moderation metadata", async () => {
    const book = fakeBook({
      status: "taken-down",
      takenDownReason: "dmca",
      takenDownAt: new Date(),
      takenDownBy: ADMIN_ID,
      purchaserAccessAllowed: false,
    });
    Book.findById.mockResolvedValue(book);
    const res = mockRes();

    await settle(
      restoreBook({ params: { id: BOOK_ID }, user: admin }, res, jest.fn()),
      res,
      jest.fn()
    );

    expect(book.status).toBe("active");
    expect(book.takenDownReason).toBeNull();
    expect(book.takenDownAt).toBeNull();
    expect(book.takenDownBy).toBeNull();
    expect(book.purchaserAccessAllowed).toBe(true);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "book.restore", targetId: BOOK_ID })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 409 when the book is not taken down", async () => {
    Book.findById.mockResolvedValue(fakeBook());
    const next = jest.fn();
    const res = mockRes();
    await settle(
      restoreBook({ params: { id: BOOK_ID }, user: admin }, res, next),
      res,
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  });
});

describe("catalog visibility", () => {
  it("excludes taken-down books from the public list query", async () => {
    Book.find.mockReturnValue(query([]));
    const res = mockRes();
    await getBooks({ query: {} }, res);
    expect(Book.find).toHaveBeenCalledWith({
      status: { $ne: "taken-down" },
    });
  });

  it("lists every book for admins", async () => {
    Book.find.mockReturnValue(query([{ _id: BOOK_ID, status: "taken-down" }]));
    const res = mockRes();
    await settle(getAdminBooks({ query: {} }, res, jest.fn()), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("hides a taken-down detail from anonymous viewers", async () => {
    Book.findById.mockReturnValue(
      query({ _id: BOOK_ID, author: { _id: AUTHOR_ID }, status: "taken-down" })
    );
    const res = mockRes();
    await getBook({ params: { id: BOOK_ID }, user: undefined }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("allows admins to view a taken-down detail", async () => {
    Book.findById.mockReturnValue(
      query({ _id: BOOK_ID, author: { _id: AUTHOR_ID }, status: "taken-down" })
    );
    const res = mockRes();
    await getBook({ params: { id: BOOK_ID }, user: admin }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("allows a purchaser when licensing permits it", async () => {
    Book.findById.mockReturnValue(
      query({
        _id: BOOK_ID,
        author: { _id: AUTHOR_ID },
        status: "taken-down",
        purchaserAccessAllowed: true,
      })
    );
    User.findById.mockReturnValue(query({ purchasedBooks: [{ bookId: BOOK_ID }] }));
    const res = mockRes();
    await getBook({ params: { id: BOOK_ID }, user: student }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("denies a purchaser when licensing forbids it", async () => {
    Book.findById.mockReturnValue(
      query({
        _id: BOOK_ID,
        author: { _id: AUTHOR_ID },
        status: "taken-down",
        purchaserAccessAllowed: false,
      })
    );
    User.findById.mockReturnValue(query({ purchasedBooks: [{ bookId: BOOK_ID }] }));
    const res = mockRes();
    await getBook({ params: { id: BOOK_ID }, user: student }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("denies preview reading to a non-purchaser while taken down", async () => {
    Book.findById.mockReturnValue(
      query({
        _id: BOOK_ID,
        author: { _id: AUTHOR_ID },
        status: "taken-down",
        price: 10,
        fileUrl: "https://example.com/book.pdf",
        purchaserAccessAllowed: true,
      })
    );
    User.findById.mockReturnValue(query({ purchasedBooks: [] }));
    const res = mockRes();
    await streamBookPreview(
      { params: { id: BOOK_ID }, user: student, headers: {} },
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
