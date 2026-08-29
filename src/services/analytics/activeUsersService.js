// services/analytics/activeUsersService.js
//
// Real-time active-user tracking backed by a Redis sorted set. Each
// authenticated request bumps the user's "last seen" score; users whose score
// falls outside the (configurable) activity window are pruned, and the
// concurrent active-user count is simply the size of the set.
//
// Degrades gracefully: when Redis is unavailable every method becomes a no-op
// (tracking is skipped, the count is 0) so the platform keeps working without
// the analytics layer.

import { getRedisClient, isRedisReady } from "../../config/redis.js";

const ACTIVE_USERS_KEY = "analytics:active-users";
const DEFAULT_TIMEOUT_SECONDS = 300; // 5 minutes

export class ActiveUsersService {
  /**
   * @param {object} [options]
   * @param {import("redis").RedisClientType|null} [options.redis] - Optional
   *   injected client (used by tests). Defaults to the app's shared client.
   * @param {number|null} [options.timeoutSeconds] - Inactivity timeout override.
   */
  constructor({ redis = null, timeoutSeconds = null } = {}) {
    this.redis = redis;
    this.timeoutSeconds = timeoutSeconds;
  }

  /**
   * How long (seconds) a user may stay idle before they stop counting as
   * active. Reads ACTIVE_USER_TIMEOUT_SECONDS unless overridden (e.g. by a
   * test or a caller that wants a different window).
   */
  getTimeoutSeconds() {
    return (
      this.timeoutSeconds ||
      parseInt(process.env.ACTIVE_USER_TIMEOUT_SECONDS || String(DEFAULT_TIMEOUT_SECONDS), 10) ||
      DEFAULT_TIMEOUT_SECONDS
    );
  }

  /** @returns {import("redis").RedisClientType|null} The Redis client in use. */
  _client() {
    return this.redis || getRedisClient();
  }

  /** @returns {boolean} Whether a usable Redis client is available. */
  _isReady() {
    return this.redis ? true : isRedisReady();
  }

  /**
   * Record activity for a user (idempotent — one entry per user) and prune
   * entries that have been idle longer than the timeout.
   *
   * @param {object} params
   * @param {string|number} params.userId - The authenticated user's id.
   * @returns {Promise<number>} 1 when tracked, 0 when Redis is unavailable.
   */
  async trackActivity({ userId }) {
    if (!userId) return 0;
    if (!this._isReady()) return 0;

    const client = this._client();
    const now = Date.now();
    const timeoutMs = this.getTimeoutSeconds() * 1000;

    await client.zAdd(ACTIVE_USERS_KEY, [{ score: now, value: String(userId) }]);
    await client.zRemRangeByScore(ACTIVE_USERS_KEY, 0, now - timeoutMs);
    return 1;
  }

  /**
   * Current number of concurrent active users (unique users seen within the
   * activity window).
   *
   * @returns {Promise<number>} The count, or 0 when Redis is unavailable.
   */
  async getActiveUserCount() {
    if (!this._isReady()) return 0;

    const client = this._client();
    const now = Date.now();
    const timeoutMs = this.getTimeoutSeconds() * 1000;

    await client.zRemRangeByScore(ACTIVE_USERS_KEY, 0, now - timeoutMs);
    return client.zCard(ACTIVE_USERS_KEY);
  }

  /**
   * Test/dependency-injection seam: swap in a Redis-compatible client.
   *
   * @param {import("redis").RedisClientType|null} client - The client to use.
   */
  setRedis(client) {
    this.redis = client;
  }

  /**
   * Override the inactivity timeout (used by tests to simulate expiry).
   *
   * @param {number} seconds - Timeout in seconds.
   */
  setTimeoutSeconds(seconds) {
    this.timeoutSeconds = seconds;
  }
}

export const activeUsersService = new ActiveUsersService();
export default activeUsersService;
