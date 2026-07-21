import { jest } from "@jest/globals";
import request from "supertest";
import app from "../app.js";
import {
  enqueue,
  registerJob,
  resetInlineQueueForTests,
  waitForIdle,
} from "../src/jobs/queue.js";

describe("background job queue", () => {
  beforeEach(() => {
    process.env.QUEUE_DRIVER = "inline";
    resetInlineQueueForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("deduplicates jobs with the same idempotency key", async () => {
    const handler = jest.fn();
    registerJob("test-idempotency", handler);

    const first = await enqueue("test-idempotency", { recordId: "one" }, { idempotencyKey: "same" });
    const second = await enqueue("test-idempotency", { recordId: "one" }, { idempotencyKey: "same" });
    await waitForIdle();

    expect(first.queued).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries failed work with backoff", async () => {
    jest.useFakeTimers();
    const handler = jest
      .fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce();
    registerJob("test-retry", handler);

    await enqueue(
      "test-retry",
      { recordId: "retry-me" },
      { attempts: 3, backoffMs: 100, idempotencyKey: "retry-once" }
    );
    await jest.runAllTimersAsync();
    await waitForIdle();

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls.map((call) => call[1].attempt)).toEqual([1, 2, 3]);
  });

  it("protects the jobs dashboard with a bearer token", async () => {
    process.env.JOBS_DASHBOARD_TOKEN = "dashboard-secret";

    const missing = await request(app).get("/admin/jobs");
    const wrong = await request(app)
      .get("/admin/jobs")
      .set("Authorization", "Bearer wrong");

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
  });
});
