import request from "supertest";
import app from "../app.js";
import { checkDatabaseHealth } from "../mongo/utils/healthCheck.js";

describe("Database Health Endpoint", () => {
  it("GET /health/database should return health status and connection details", async () => {
    const res = await request(app).get("/health/database");
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("success");
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toHaveProperty("status");
    expect(res.body.data).toHaveProperty("connection");
    expect(res.body.data).toHaveProperty("responseTimeMs");
  });

  it("checkDatabaseHealth utility should return formatted object", async () => {
    const health = await checkDatabaseHealth();
    expect(health).toHaveProperty("healthy");
    expect(health).toHaveProperty("status");
    expect(health).toHaveProperty("connection");
    expect(typeof health.responseTimeMs).toBe("number");
  });
});
