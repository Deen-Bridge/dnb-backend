import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";

const create = jest.fn();
const findOne = jest.fn();
jest.unstable_mockModule("../src/models/IdempotencyKey.js", () => ({
  default: {
    create,
    findOne,
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
  },
}));
jest.unstable_mockModule("../src/config/logger.js", () => ({
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const { idempotency } = await import("../src/middlewares/idempotency.js");

const ROUTE_FILES = [
  "src/routes/stellar/paymentRoutes.js",
  "src/routes/payoutRoutes.js",
  "src/routes/stellar/donationRoutes.js",
  "src/routes/stellar/giftRoutes.js",
  "src/routes/stellar/pledgeRoutes.js",
];
// Read-only POSTs (no state change), intentionally unprotected.
const READ_ONLY = new Set(['"/quote"', '"/preflight"']);

describe("idempotency coverage on mutating payment routes", () => {
  test.each(ROUTE_FILES)("%s applies idempotency() to every mutating route", (file) => {
    const src = fs.readFileSync(path.resolve(file), "utf8");
    const re = /router\.(post|put|patch|delete)\(\s*("[^"]*")([\s\S]*?)\);/g;
    let m;
    let count = 0;
    while ((m = re.exec(src))) {
      count++;
      if (READ_ONLY.has(m[2])) continue;
      expect({ route: `${m[1]} ${m[2]}`, ok: m[3].includes("idempotency(") }).toEqual({
        route: `${m[1]} ${m[2]}`,
        ok: true,
      });
    }
    expect(count).toBeGreaterThan(0);
  });
});

describe("idempotency middleware behaviour", () => {
  const makeApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { _id: "u1" };
      next();
    });
    const handler = jest.fn((req, res) => res.status(201).json({ ok: true }));
    app.post("/pay", idempotency(), handler);
    app.use((err, _req, res, _next) =>
      res.status(err.statusCode || 500).json({ message: err.message })
    );
    return { app, handler };
  };

  beforeEach(() => jest.clearAllMocks());

  test("duplicate key replays the stored response without re-running the handler", async () => {
    const { app, handler } = makeApp();
    const crypto = await import("crypto");
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ a: 1 }))
      .digest("hex");
    create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    findOne.mockResolvedValue({
      requestHash: hash,
      status: "completed",
      statusCode: 201,
      responseBody: { ok: true },
    });
    const res = await request(app).post("/pay").set("Idempotency-Key", "k1").send({ a: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(handler).not.toHaveBeenCalled();
  });

  test("missing key passes through (backwards compatible)", async () => {
    const { app, handler } = makeApp();
    const res = await request(app).post("/pay").send({ a: 1 });
    expect(res.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  test("store failure fails closed: handler is not run and a 500 is returned (#413)", async () => {
    const { app, handler } = makeApp();
    create.mockRejectedValue(new Error("mongo down"));
    const res = await request(app).post("/pay").set("Idempotency-Key", "k2").send({ a: 1 });
    expect(res.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });
});
