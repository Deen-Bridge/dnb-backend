import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import { errorHandler } from "../src/middlewares/errorHandler.js";

const h = (name) => jest.fn((_req, res) => res.status(200).json({ handler: name }));
const searchAll = h("searchAll");
const searchEducatorsHandler = h("searchEducators");
const categoryHandlers = {
  listCategories: h("list"),
  getCategory: h("get"),
  createCategory: h("create"),
  updateCategory: h("update"),
  deleteCategory: h("delete"),
};

jest.unstable_mockModule("../src/controllers/searchController.js", () => ({ searchAll, searchEducatorsHandler }));
jest.unstable_mockModule("../src/controllers/categoryController.js", () => categoryHandlers);
jest.unstable_mockModule("../src/middlewares/authMiddleware.js", () => ({
  protect: (_req, _res, next) => next(),
  authorizeRoles: () => (_req, _res, next) => next(),
}));
jest.unstable_mockModule("../src/middlewares/cache.js", () => ({
  cacheMiddleware: () => (_req, _res, next) => next(),
  invalidateCacheMiddleware: () => (_req, _res, next) => next(),
}));
jest.unstable_mockModule("../src/middlewares/analytics/search-logger.js", () => ({
  searchLogger: (_req, _res, next) => next(),
}));
jest.unstable_mockModule("../src/config/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { default: searchRoutes } = await import("../src/routes/searchRoutes.js");
const { default: categoryRoutes } = await import("../src/routes/categoryRoutes.js");

const app = express();
app.use(express.json());
app.use("/api/search", searchRoutes);
app.use("/api/categories", categoryRoutes);
app.use(errorHandler);

const validId = "507f1f77bcf86cd799439011";

beforeEach(() => jest.clearAllMocks());

describe("GET /api/search validation", () => {
  it("accepts no params, empty q and valid filters", async () => {
    expect((await request(app).get("/api/search")).status).toBe(200);
    expect((await request(app).get("/api/search").query({ q: "" })).status).toBe(200);
    const res = await request(app)
      .get("/api/search")
      .query({ q: "fiqh", type: "courses", sort: "price", page: 2, limit: 100, minPrice: 0, free: "true" });
    expect(res.status).toBe(200);
    expect(searchAll).toHaveBeenCalledTimes(3);
  });

  it.each([
    [{ type: "bogus" }],
    [{ limit: 101 }],
    [{ page: 0 }],
    [{ sort: "drop" }],
    [{ minPrice: -1 }],
  ])("rejects %j with 400", async (qs) => {
    const res = await request(app).get("/api/search").query(qs);
    expect(res.status).toBe(400);
    expect(searchAll).not.toHaveBeenCalled();
  });

  it("rejects array q", async () => {
    const res = await request(app).get("/api/search?q=a&q=b");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/search/educators validation", () => {
  it("accepts valid params", async () => {
    const res = await request(app).get("/api/search/educators").query({ q: "ali", limit: 10 });
    expect(res.status).toBe(200);
    expect(searchEducatorsHandler).toHaveBeenCalled();
  });
  it("rejects oversize limit", async () => {
    const res = await request(app).get("/api/search/educators").query({ limit: 500 });
    expect(res.status).toBe(400);
    expect(searchEducatorsHandler).not.toHaveBeenCalled();
  });
});

describe("category routes validation", () => {
  it("GET / is untouched", async () => {
    expect((await request(app).get("/api/categories")).status).toBe(200);
  });

  it("GET /:slug accepts valid and rejects bad query", async () => {
    expect((await request(app).get("/api/categories/fiqh").query({ sort: "popular", limit: 20 })).status).toBe(200);
    const bad = await request(app).get("/api/categories/fiqh").query({ sort: "x" });
    expect(bad.status).toBe(400);
    expect(categoryHandlers.getCategory).toHaveBeenCalledTimes(1);
  });

  it("POST / accepts valid body, rejects missing name and bad parent", async () => {
    const ok = await request(app).post("/api/categories").send({ name: "Fiqh", description: "d", parent: validId, order: 1 });
    expect(ok.status).toBe(200);
    expect((await request(app).post("/api/categories").send({ name: "Top", parent: "" })).status).toBe(200);
    expect((await request(app).post("/api/categories").send({ description: "x" })).status).toBe(400);
    expect((await request(app).post("/api/categories").send({ name: "A", parent: "nope" })).status).toBe(400);
    expect((await request(app).post("/api/categories").send({ name: "A", description: "x".repeat(1001) })).status).toBe(400);
    expect(categoryHandlers.createCategory).toHaveBeenCalledTimes(2);
  });

  it("POST / strips HTML from the body", async () => {
    await request(app).post("/api/categories").send({ name: "<b>Fiqh</b>" });
    expect(categoryHandlers.createCategory.mock.calls[0][0].body.name).toBe("Fiqh");
  });

  it("PATCH /:id validates id and body", async () => {
    expect((await request(app).patch(`/api/categories/${validId}`).send({ isActive: false })).status).toBe(200);
    expect((await request(app).patch("/api/categories/not-an-id").send({})).status).toBe(400);
    expect((await request(app).patch(`/api/categories/${validId}`).send({ parent: "bad" })).status).toBe(400);
    expect(categoryHandlers.updateCategory).toHaveBeenCalledTimes(1);
  });

  it("DELETE /:id validates id", async () => {
    expect((await request(app).delete(`/api/categories/${validId}`)).status).toBe(200);
    expect((await request(app).delete("/api/categories/123")).status).toBe(400);
    expect(categoryHandlers.deleteCategory).toHaveBeenCalledTimes(1);
  });
});
