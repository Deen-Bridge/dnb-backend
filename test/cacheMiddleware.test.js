import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

// In-memory fake Redis client
const store = new Map();
const fakeClient = {
  get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
  setEx: jest.fn(async (k, _ttl, v) => {
    store.set(k, v);
  }),
  keys: jest.fn(async (pattern) => {
    const re = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
    return [...store.keys()].filter((k) => re.test(k));
  }),
  del: jest.fn(async (keys) => {
    for (const k of [].concat(keys)) store.delete(k);
  }),
};
let redisReady = true;

jest.unstable_mockModule("../src/config/redis.js", () => ({
  getRedisClient: () => fakeClient,
  isRedisReady: () => redisReady,
}));

const { cacheMiddleware, invalidateCacheMiddleware, smartCache } = await import(
  "../src/middlewares/cache.js"
);

const flush = () => new Promise((r) => setImmediate(r));

let handlerCalls;
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.get("/items", cacheMiddleware(60), (req, res) => {
    handlerCalls += 1;
    res.json({ n: handlerCalls });
  });
  app.get("/smart", smartCache({ prefix: "p" }), (req, res) => {
    handlerCalls += 1;
    res.json({ q: req.query.q, n: handlerCalls });
  });
  app.get("/private", cacheMiddleware(60), (req, res) => {
    handlerCalls += 1;
    res.set("Cache-Control", "no-store");
    res.json({ n: handlerCalls });
  });
  app.post("/items", cacheMiddleware(60), (req, res) => {
    handlerCalls += 1;
    res.status(201).json({ created: true });
  });
  app.post("/items/ok", invalidateCacheMiddleware(["route:/items*"]), (req, res) =>
    res.status(201).json({ ok: true })
  );
  app.post("/items/fail", invalidateCacheMiddleware(["route:/items*"]), (req, res) =>
    res.status(400).json({ ok: false })
  );
  return app;
};

let app;
beforeEach(() => {
  store.clear();
  handlerCalls = 0;
  redisReady = true;
  jest.clearAllMocks();
  app = buildApp();
});

describe("cacheMiddleware", () => {
  it("misses on first GET, stores response with TTL, then serves hit from cache", async () => {
    const first = await request(app).get("/items");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ n: 1 });
    await flush();
    expect(fakeClient.setEx).toHaveBeenCalledWith("route:/items", 60, JSON.stringify({ n: 1 }));

    const second = await request(app).get("/items");
    expect(second.body).toEqual({ n: 1 });
    expect(handlerCalls).toBe(1);
  });

  it("keys by full original URL so different queries do not collide", async () => {
    await request(app).get("/items?page=1");
    await flush();
    const res = await request(app).get("/items?page=2");
    expect(res.body).toEqual({ n: 2 });
    expect(store.has("route:/items?page=1")).toBe(true);
    expect(store.has("route:/items?page=2")).toBe(true);
  });

  it("does not cache or read cache for non-GET requests", async () => {
    await request(app).post("/items").send({});
    await request(app).post("/items").send({});
    await flush();
    expect(handlerCalls).toBe(2);
    expect(fakeClient.get).not.toHaveBeenCalled();
    expect(fakeClient.setEx).not.toHaveBeenCalled();
  });

  it("falls through to the handler when Redis is unavailable", async () => {
    redisReady = false;
    const a = await request(app).get("/items");
    const b = await request(app).get("/items");
    expect(a.status).toBe(200);
    expect(b.body).toEqual({ n: 2 });
    expect(fakeClient.setEx).not.toHaveBeenCalled();
  });

  it("still responds when the store errors on get and set", async () => {
    fakeClient.get.mockRejectedValueOnce(new Error("boom"));
    fakeClient.setEx.mockRejectedValueOnce(new Error("boom"));
    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ n: 1 });
  });

  it("treats corrupt cached JSON as a miss", async () => {
    store.set("route:/items", "{not json");
    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ n: 1 });
  });
});

describe("smartCache", () => {
  it("builds keys from prefix, path and query string", async () => {
    await request(app).get("/smart?q=abc");
    await flush();
    expect(store.has("p:/smart:q=abc")).toBe(true);
    const hit = await request(app).get("/smart?q=abc");
    expect(hit.body).toEqual({ q: "abc", n: 1 });
  });
});

describe("invalidateCacheMiddleware", () => {
  it("clears matching keys after a successful write", async () => {
    await request(app).get("/items");
    await flush();
    expect(store.size).toBe(1);

    const res = await request(app).post("/items/ok").send({});
    expect(res.status).toBe(201);
    expect(store.size).toBe(0);

    const after = await request(app).get("/items");
    expect(after.body).toEqual({ n: 2 });
  });

  it("does not invalidate when the response is not 2xx", async () => {
    await request(app).get("/items");
    await flush();
    const res = await request(app).post("/items/fail").send({});
    expect(res.status).toBe(400);
    expect(store.size).toBe(1);
  });

  it("still responds if the store errors during invalidation", async () => {
    fakeClient.keys.mockRejectedValueOnce(new Error("boom"));
    const res = await request(app).post("/items/ok").send({});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });
});
