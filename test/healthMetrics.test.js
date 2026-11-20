import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import {
  createHealthHandler,
  ping,
  startupCheck,
} from "../src/controllers/healthController.js";
import {
  metricsMiddleware,
  paymentsInitialized,
} from "../src/config/metrics.js";

const buildHealthApp = (deps) => {
  const app = express();
  app.get("/health", createHealthHandler(deps));
  app.get("/ping", ping);
  return app;
};

describe("GET /health", () => {
  it("returns 200 with the full readiness shape when all dependencies are up", async () => {
    const app = buildHealthApp({
      getMongoReadyState: () => 1,
      getRedisReady: () => true,
      getUptime: () => 42,
      getEnvironment: () => "test",
    });
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: "All critical dependencies are ready",
      data: {
        status: "healthy",
        probe: "readiness",
        uptime: 42,
        environment: "test",
        dependencies: {
          mongodb: { status: "up", state: "connected" },
          redis: { status: "up" },
        },
      },
    });
    expect(new Date(res.body.data.timestamp).toISOString()).toBe(
      res.body.data.timestamp
    );
  });

  it("returns 503 when MongoDB is down", async () => {
    const app = buildHealthApp({
      getMongoReadyState: () => 0,
      getRedisReady: () => true,
    });
    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.data.status).toBe("unhealthy");
    expect(res.body.data.dependencies.mongodb).toEqual({
      status: "down",
      state: "disconnected",
    });
    expect(res.body.data.dependencies.redis.status).toBe("up");
  });

  it("returns 503 when Redis is down", async () => {
    const app = buildHealthApp({
      getMongoReadyState: () => 1,
      getRedisReady: () => false,
    });
    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.data.dependencies.redis.status).toBe("degraded");
    expect(res.body.data.dependencies.mongodb.status).toBe("up");
  });

  it("reports an unknown mongo state without crashing", async () => {
    const app = buildHealthApp({
      getMongoReadyState: () => 99,
      getRedisReady: () => true,
    });
    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.data.dependencies.mongodb.state).toBe("unknown");
  });

  it("liveness /ping returns pong", async () => {
    const res = await request(buildHealthApp()).get("/ping");
    expect(res.status).toBe(200);
    expect(res.text).toBe("pong");
  });

  it("startup probe reports its distinct probe contract", () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    startupCheck({}, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ probe: "startup" }),
      })
    );
  });

  it("startup stays available during a recoverable Redis outage", () => {
    const handler = createHealthHandler({
      probe: "startup",
      requiredDependencies: ["mongodb"],
      getMongoReadyState: () => 1,
      getRedisReady: () => false,
    });
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          probe: "startup",
          status: "healthy",
          dependencies: expect.objectContaining({
            redis: expect.objectContaining({ status: "degraded" }),
          }),
        }),
      })
    );
  });
});

describe("GET /metrics", () => {
  const originalToken = process.env.METRICS_TOKEN;
  const app = express();
  app.get("/metrics", metricsMiddleware);

  afterEach(() => {
    if (originalToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = originalToken;
  });

  it("serves Prometheus text including default and custom metrics", async () => {
    delete process.env.METRICS_TOKEN;
    paymentsInitialized.inc({ type: "course" });
    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("# HELP http_request_duration_seconds");
    expect(res.text).toContain("# TYPE payments_initialized_total counter");
    expect(res.text).toMatch(/payments_initialized_total\{type="course"\} \d+/);
    expect(res.text).toContain("process_cpu_user_seconds_total");
  });

  it("rejects requests with a missing or wrong bearer token when METRICS_TOKEN is set", async () => {
    process.env.METRICS_TOKEN = "secret-token";

    const missing = await request(app).get("/metrics");
    expect(missing.status).toBe(401);
    expect(missing.body.success).toBe(false);

    const wrong = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer nope");
    expect(wrong.status).toBe(401);
  });

  it("allows requests with the correct bearer token", async () => {
    process.env.METRICS_TOKEN = "secret-token";
    const res = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer secret-token");
    expect(res.status).toBe(200);
    expect(res.text).toContain("# TYPE");
  });
});
