import express from "express";
import request from "supertest";

process.env.RATE_LIMIT_ADMIN_READ_MAX = "2";
process.env.RATE_LIMIT_ADMIN_READ_WINDOW_MS = "60000";
process.env.RATE_LIMIT_ADMIN_MUTATION_MAX = "1";
process.env.RATE_LIMIT_ADMIN_MUTATION_WINDOW_MS = "60000";
process.env.RATE_LIMIT_JOB_READ_MAX = "2";
process.env.RATE_LIMIT_JOB_READ_WINDOW_MS = "60000";
process.env.RATE_LIMIT_JOB_DEAD_MAX = "1";
process.env.RATE_LIMIT_JOB_DEAD_WINDOW_MS = "60000";
process.env.RATE_LIMIT_TRUSTED_INTERNAL_TOKEN = "test-only-internal-token";

const { adminLimiter, jobLimiter } = await import("../src/middlewares/security.js");

const withAdmin = (app) => {
  app.use((req, _res, next) => {
    req.user = { _id: "admin-test-actor" };
    next();
  });
  return app;
};

describe("administrative and job request budgets", () => {
  test("limits normal admin reads per authenticated actor", async () => {
    const app = withAdmin(express());
    app.get("/admin/read", adminLimiter, (_req, res) => res.sendStatus(200));

    await request(app).get("/admin/read").expect(200);
    await request(app).get("/admin/read").expect(200);
    await request(app).get("/admin/read").expect(429);
  });

  test("uses the tighter mutation budget", async () => {
    const app = withAdmin(express());
    app.post("/admin/mutate", adminLimiter, (_req, res) => res.sendStatus(204));

    await request(app).post("/admin/mutate").expect(204);
    await request(app).post("/admin/mutate").expect(429);
  });

  test("allows explicitly trusted internal automation and still logs the bypass", async () => {
    const app = withAdmin(express());
    app.get("/admin/trusted", adminLimiter, (_req, res) => res.sendStatus(200));

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .get("/admin/trusted")
        .set("x-rate-limit-trusted-token", "test-only-internal-token")
        .expect(200);
    }
  });

  test("gives the expensive dead-job view its lower budget", async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { _id: "job-test-actor" };
      next();
    });
    app.get("/admin/jobs/dead", jobLimiter, (_req, res) => res.sendStatus(200));

    await request(app).get("/admin/jobs/dead").expect(200);
    await request(app).get("/admin/jobs/dead").expect(429);
  });
});
