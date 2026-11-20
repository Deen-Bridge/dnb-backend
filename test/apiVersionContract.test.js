import express from "express";
import request from "supertest";
import { apiVersionContractHeaders } from "../src/middlewares/apiVersionContract.js";
import { versionMiddleware } from "../src/middlewares/versionMiddleware.js";

const buildContractApp = () => {
  const app = express();
  app.use(versionMiddleware, apiVersionContractHeaders);
  app.get("/api/v1/contract", (req, res) => res.json({ version: req.apiVersion }));
  app.get("/api/v2/contract", (req, res) => res.json({ version: req.apiVersion }));
  return app;
};

describe("versioned API contract", () => {
  const originalSunset = process.env.API_V1_SUNSET_DATE;

  afterEach(() => {
    if (originalSunset === undefined) delete process.env.API_V1_SUNSET_DATE;
    else process.env.API_V1_SUNSET_DATE = originalSunset;
  });

  test.each([
    ["v1", 1, "stable"],
    ["v2", 2, "compatibility"],
  ])("publishes the contract for /api/%s", async (path, version, stability) => {
    const response = await request(buildContractApp()).get(`/api/${path}/contract`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ version });
    expect(response.headers["x-api-version"]).toBe(`v${version}`);
    expect(response.headers["x-api-stability"]).toBe(stability);
  });

  test("adds opt-in deprecation metadata to v1", async () => {
    process.env.API_V1_SUNSET_DATE = "2027-01-01";
    const response = await request(buildContractApp()).get("/api/v1/contract");
    expect(response.headers.deprecation).toBe("true");
    expect(response.headers.sunset).toContain("01 Jan 2027");
    expect(response.headers.link).toContain('rel="deprecation"');
  });

  test("does not label unversioned endpoints as versioned", async () => {
    const app = buildContractApp();
    app.get("/health", (req, res) => res.json({ ok: true }));
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.headers["x-api-version"]).toBeUndefined();
  });
});
