import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

// Isolated router test: the search service, analytics service, logger and
// cache are all mocked, so no DB / Redis is needed.
const searchCollections = jest.fn();
const searchEducators = jest.fn();
const logSearchEvent = jest.fn();

jest.unstable_mockModule("../src/services/search/searchService.js", () => ({
  searchCollections,
  searchEducators,
}));
jest.unstable_mockModule("../src/services/analytics/search-analytics-service.js", () => ({
  logSearchEvent,
}));
jest.unstable_mockModule("../src/middlewares/cache.js", () => ({
  cacheMiddleware: () => (_req, _res, next) => next(),
}));
jest.unstable_mockModule("../src/config/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { default: searchRoutes } = await import("../src/routes/searchRoutes.js");

const app = express();
app.use("/api/search", searchRoutes);

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  logSearchEvent.mockResolvedValue({});
});

describe("GET /api/search", () => {
  it("returns results and pagination, trimming the query", async () => {
    searchCollections.mockResolvedValue({
      results: { courses: [{ _id: "c1" }, { _id: "c2" }], books: [{ _id: "b1" }] },
      pagination: { page: 1, limit: 20, total: 3 },
    });

    const res = await request(app).get("/api/search").query({ q: "  fiqh  ", type: "courses" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.courses).toHaveLength(2);
    expect(res.body.pagination.total).toBe(3);
    expect(searchCollections).toHaveBeenCalledWith(
      expect.objectContaining({ q: "fiqh", type: "courses" })
    );
  });

  it("treats a missing query as an empty string", async () => {
    searchCollections.mockResolvedValue({ results: {}, pagination: {} });
    const res = await request(app).get("/api/search");
    expect(res.status).toBe(200);
    expect(searchCollections).toHaveBeenCalledWith(expect.objectContaining({ q: "" }));
  });

  it("rejects queries longer than 100 characters with a standard error shape", async () => {
    const res = await request(app).get("/api/search").query({ q: "a".repeat(101) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBeDefined();
    expect(res.body.message).toBe("Query string is too long.");
    expect(searchCollections).not.toHaveBeenCalled();
  });

  it("returns 500 'Server error' without leaking internals when the service throws", async () => {
    searchCollections.mockRejectedValue(new Error("db exploded"));
    const res = await request(app).get("/api/search").query({ q: "quran" });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Server error");
    expect(JSON.stringify(res.body)).not.toContain("db exploded");
  });

  it("maps service errors carrying a statusCode", async () => {
    searchCollections.mockRejectedValue(Object.assign(new Error("bad cursor"), { statusCode: 400 }));
    const res = await request(app).get("/api/search").query({ q: "x" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("bad cursor");
  });
});

describe("GET /api/search/educators", () => {
  it("returns educators and logs analytics", async () => {
    searchEducators.mockResolvedValue({ results: [{ _id: "e1" }], pagination: { total: 1 } });
    const res = await request(app).get("/api/search/educators").query({ q: "ali" });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    await flush();
    expect(logSearchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ query: "ali", resultCount: 1, hasResults: true })
    );
  });

  it("returns 500 when the service fails", async () => {
    searchEducators.mockRejectedValue(new Error("boom"));
    const res = await request(app).get("/api/search/educators").query({ q: "ali" });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe("search analytics logging", () => {
  it("logs query, type, counts, filters, session and user agent", async () => {
    searchCollections.mockResolvedValue({
      results: { courses: [{ _id: "c1" }], books: [{ _id: "b1" }, { _id: "b2" }] },
      pagination: {},
    });

    await request(app)
      .get("/api/search")
      .set("x-session-id", "sess-1")
      .set("User-Agent", "jest-agent")
      .query({ q: "tafsir", type: "all", category: "quran", minPrice: "5" });
    await flush();

    expect(logSearchEvent).toHaveBeenCalledTimes(1);
    expect(logSearchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        sessionId: "sess-1",
        query: "tafsir",
        type: "all",
        resultCount: 3,
        hasResults: true,
        userAgent: "jest-agent",
        filters: expect.objectContaining({ category: "quran", minPrice: "5", maxPrice: null }),
      })
    );
  });

  it("flags zero-result searches", async () => {
    searchCollections.mockResolvedValue({ results: { courses: [] }, pagination: {} });
    await request(app).get("/api/search").query({ q: "nothing" });
    await flush();
    expect(logSearchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ resultCount: 0, hasResults: false })
    );
  });

  it("does not log when the query is empty or whitespace", async () => {
    searchCollections.mockResolvedValue({ results: {}, pagination: {} });
    await request(app).get("/api/search");
    await request(app).get("/api/search").query({ q: "   " });
    await flush();
    expect(logSearchEvent).not.toHaveBeenCalled();
  });

  it("never fails the search response when the analytics write rejects", async () => {
    logSearchEvent.mockRejectedValue(new Error("analytics down"));
    searchCollections.mockResolvedValue({ results: { courses: [] }, pagination: {} });
    const res = await request(app).get("/api/search").query({ q: "quran" });
    await flush();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
