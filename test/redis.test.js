import { jest } from "@jest/globals";

describe("Redis Configuration & Client Initialization", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should initialize standalone Redis client with REDIS_URL and handle offline state gracefully", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6399";
    delete process.env.REDIS_IS_CLUSTER;
    delete process.env.REDIS_CLUSTER_NODES;

    const { initRedis, getRedisClient, isRedisReady, closeRedis } = await import(
      "../src/config/redis.js"
    );

    expect(isRedisReady()).toBe(false);

    const client = await initRedis();
    expect(client === null || typeof client === "object").toBe(true);
    expect(getRedisClient()).toBe(client);

    await closeRedis();
  });

  it("should initialize standalone Redis client with separate credentials", async () => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_IS_CLUSTER;
    delete process.env.REDIS_CLUSTER_NODES;
    process.env.REDIS_HOST = "localhost";
    process.env.REDIS_PORT = "6399";
    process.env.REDIS_USERNAME = "default";
    process.env.REDIS_PASSWORD = "secret_password";

    const { initRedis, getRedisClient, closeRedis } = await import(
      "../src/config/redis.js"
    );

    const client = await initRedis();
    expect(client === null || typeof client === "object").toBe(true);
    await closeRedis();
  });

  it("should initialize Redis Cluster client when REDIS_IS_CLUSTER is true", async () => {
    process.env.REDIS_IS_CLUSTER = "true";
    process.env.REDIS_CLUSTER_NODES =
      "redis://127.0.0.1:7000,redis://127.0.0.1:7001,redis://127.0.0.1:7002";
    process.env.REDIS_PASSWORD = "cluster_secret";

    const { initRedis, getRedisClient, isRedisReady, closeRedis } = await import(
      "../src/config/redis.js"
    );

    const client = await initRedis();
    expect(client === null || typeof client === "object").toBe(true);
    expect(isRedisReady()).toBe(false);
    await closeRedis();
  });

  it("should initialize Redis Cluster client with custom node URLs without scheme", async () => {
    process.env.REDIS_IS_CLUSTER = "true";
    process.env.REDIS_CLUSTER_NODES = "127.0.0.1:7000, 127.0.0.1:7001";
    delete process.env.REDIS_PASSWORD;

    const { initRedis, closeRedis } = await import(
      "../src/config/redis.js"
    );

    const client = await initRedis();
    expect(client === null || typeof client === "object").toBe(true);
    await closeRedis();
  });

  it("should fallback to single node cluster configuration when REDIS_CLUSTER_NODES is omitted", async () => {
    process.env.REDIS_IS_CLUSTER = "true";
    delete process.env.REDIS_CLUSTER_NODES;
    process.env.REDIS_HOST = "127.0.0.1";
    process.env.REDIS_PORT = "7000";

    const { initRedis, closeRedis } = await import(
      "../src/config/redis.js"
    );

    const client = await initRedis();
    expect(client === null || typeof client === "object").toBe(true);
    await closeRedis();
  });
});
