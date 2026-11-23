import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import Job from "../src/models/Job.js";
import {
  JOB_DASHBOARD_LIMITS,
  redactJobError,
  resolvePage,
  toJobDto,
} from "../src/routes/jobsRoutes.js";

const TOKEN = "test-jobs-dashboard-token";

/**
 * Issue #708 — the operator job views must be paginated, return a minimal DTO
 * and never leak job payloads or raw error text.
 */
describe("Job dashboard bounds (#708)", () => {
  let mongoServer;
  let originalToken;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
    if (originalToken === undefined) delete process.env.JOBS_DASHBOARD_TOKEN;
    else process.env.JOBS_DASHBOARD_TOKEN = originalToken;
  });

  beforeAll(() => {
    originalToken = process.env.JOBS_DASHBOARD_TOKEN;
  });

  beforeEach(async () => {
    process.env.JOBS_DASHBOARD_TOKEN = TOKEN;
    await Job.deleteMany({});
  });

  const seed = (count, overrides = {}) =>
    Job.insertMany(
      Array.from({ length: count }, (_, i) => ({
        name: "notifications.bulk",
        payload: { courseId: "64b7f9c2e1a4c3d2e5f6a7b8", recipientEmail: "leak@example.com" },
        idempotencyKey: `job-${i}-${Math.random().toString(16).slice(2)}`,
        status: "queued",
        ...overrides,
      }))
    );

  const get = (path) => request(app).get(path).set("Authorization", `Bearer ${TOKEN}`);

  it("is not reachable without the operator token configured", async () => {
    delete process.env.JOBS_DASHBOARD_TOKEN;
    const res = await request(app).get("/admin/jobs");
    expect(res.status).toBe(404);
  });

  it("rejects a wrong token with 401", async () => {
    const res = await request(app).get("/admin/jobs").set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
  });

  it("defaults to the documented page size and clamps an oversized limit", async () => {
    await seed(JOB_DASHBOARD_LIMITS.maxPageSize + 5);

    const first = await get("/admin/jobs");
    expect(first.status).toBe(200);
    expect(first.body.jobs).toHaveLength(JOB_DASHBOARD_LIMITS.defaultPageSize);
    expect(first.body.pagination).toMatchObject({
      page: 1,
      limit: JOB_DASHBOARD_LIMITS.defaultPageSize,
      hasMore: true,
      nextPage: 2,
    });

    const clamped = await get("/admin/jobs?limit=5000");
    expect(clamped.body.jobs).toHaveLength(JOB_DASHBOARD_LIMITS.maxPageSize);
    expect(clamped.body.pagination.limit).toBe(JOB_DASHBOARD_LIMITS.maxPageSize);
  });

  it("pages through results without repeating or dropping rows", async () => {
    await seed(7);

    const page1 = await get("/admin/jobs?limit=3&page=1");
    const page2 = await get("/admin/jobs?limit=3&page=2");
    const page3 = await get("/admin/jobs?limit=3&page=3");

    const ids = [...page1.body.jobs, ...page2.body.jobs, ...page3.body.jobs].map((j) => j.id);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(page3.body.pagination.hasMore).toBe(false);
    expect(page3.body.pagination.nextPage).toBeNull();
  });

  it("never exposes the job payload or idempotency key", async () => {
    await seed(1);

    const json = await get("/admin/jobs");
    const serialised = JSON.stringify(json.body);
    expect(serialised).not.toContain("leak@example.com");
    expect(serialised).not.toContain("payload");
    expect(serialised).not.toContain("idempotencyKey");

    const dead = await get("/admin/jobs/dead");
    expect(JSON.stringify(dead.body)).not.toContain("leak@example.com");
  });

  it("truncates a long worker error in both the JSON and HTML views", async () => {
    await seed(1, { lastError: `provider said: ${"x".repeat(1000)}` });

    const json = await get("/admin/jobs");
    const [job] = json.body.jobs;
    expect(job.lastError.length).toBeLessThanOrEqual(JOB_DASHBOARD_LIMITS.maxErrorLength + 1);
    expect(job.lastError.startsWith("provider said:")).toBe(true);

    const html = await request(app)
      .get("/admin/jobs")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Accept", "text/html");
    expect(html.text).not.toContain("x".repeat(JOB_DASHBOARD_LIMITS.maxErrorLength + 10));
  });

  it("paginates the dead-letter view too", async () => {
    await seed(4, { status: "dead", failedAt: new Date() });
    await seed(3, { status: "queued" });

    const res = await get("/admin/jobs/dead?limit=3");
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(3);
    expect(res.body.jobs.every((job) => job.status === "dead")).toBe(true);
    expect(res.body.pagination.hasMore).toBe(true);
  });

  it("clamps nonsense paging parameters instead of failing", async () => {
    await seed(2);
    const res = await get("/admin/jobs?page=0&limit=-4");
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(JOB_DASHBOARD_LIMITS.defaultPageSize);
  });

  it("keeps the DTO and page helpers explicit", () => {
    expect(resolvePage({ limit: "999", page: "3" })).toEqual({
      page: 3,
      limit: JOB_DASHBOARD_LIMITS.maxPageSize,
      skip: JOB_DASHBOARD_LIMITS.maxPageSize * 2,
    });
    expect(redactJobError("line one\nline two")).toBe("line one line two");
    const dto = toJobDto({
      _id: "abc",
      name: "x",
      status: "dead",
      attemptsMade: 3,
      maxAttempts: 3,
      payload: { secret: "s" },
      idempotencyKey: "k",
      lastError: "boom",
    });
    expect(dto).not.toHaveProperty("payload");
    expect(dto).not.toHaveProperty("idempotencyKey");
    expect(dto.lastError).toBe("boom");
  });
});
