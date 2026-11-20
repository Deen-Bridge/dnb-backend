import crypto from "node:crypto";
import { getRedisClient, isRedisReady } from "../config/redis.js";

const LEASE_SECONDS = 5 * 60;

export async function withDistributedJobLease(name, task, { ttlSeconds = LEASE_SECONDS } = {}) {
  const redis = isRedisReady() ? getRedisClient() : null;
  if (!redis) return { acquired: false, reason: "redis_unavailable" };
  const token = crypto.randomUUID();
  const key = "job-lease:" + name;
  const acquired = await redis.set(key, token, { NX: true, EX: ttlSeconds });
  if (acquired !== "OK") return { acquired: false, reason: "lease_held" };
  try {
    return { acquired: true, result: await task() };
  } finally {
    try {
      const current = await redis.get(key);
      if (current === token) await redis.del(key);
    } catch {
      // TTL remains the recovery path if the owner disappears.
    }
  }
}
