import { getRedisClient, isRedisReady } from "../config/redis.js";
import logger from "../config/logger.js";

/**
 * Cache TTL (Time To Live) in seconds
 */
export const CACHE_TTL = {
  SHORT: 60 * 3, // 3 minutes
  MEDIUM: 60 * 10, // 10 minutes
  LONG: 60 * 30, // 30 minutes
  VERY_LONG: 60 * 60, // 1 hour

  // Specific entities
  COURSES: 60 * 15, // 15 minutes
  BOOKS: 60 * 15, // 15 minutes
  USERS: 60 * 10, // 10 minutes
  SPACES: 60 * 5, // 5 minutes
  REELS: 60 * 3, // 3 minutes
  SEARCH: 60 * 5, // 5 minutes
};

/**
 * Cache key prefixes
 */
export const CACHE_KEYS = {
  COURSES: "courses:",
  COURSE: "course:",
  BOOKS: "books:",
  BOOK: "book:",
  USERS: "users:",
  USER: "user:",
  SPACES: "spaces:",
  SPACE: "space:",
  REELS: "reels:",
  REEL: "reel:",
  SEARCH: "search:",
};

/**
 * Set cache
 */
export const setCache = async (key, value, ttl = CACHE_TTL.MEDIUM) => {
  try {
    if (!isRedisReady()) {
      logger.warn("⚠️  Redis not available, skipping cache set");
      return false;
    }

    const client = getRedisClient();
    const stringValue = JSON.stringify(value);

    await client.setEx(key, ttl, stringValue);
    logger.debug(`✅ Cache set: ${key} (TTL: ${ttl}s)`);
    return true;
  } catch (error) {
    logger.error(`❌ Cache set error for key ${key}:`, error);
    return false;
  }
};

/**
 * Get cache
 */
export const getCache = async (key) => {
  try {
    if (!isRedisReady()) {
      return null;
    }

    const client = getRedisClient();
    const value = await client.get(key);

    if (value) {
      logger.debug(`✅ Cache hit: ${key}`);
      return JSON.parse(value);
    }

    logger.debug(`❌ Cache miss: ${key}`);
    return null;
  } catch (error) {
    logger.error(`❌ Cache get error for key ${key}:`, error);
    return null;
  }
};

/**
 * Delete cache
 */
export const deleteCache = async (key) => {
  try {
    if (!isRedisReady()) {
      return false;
    }

    const client = getRedisClient();
    await client.del(key);
    logger.debug(`🗑️  Cache deleted: ${key}`);
    return true;
  } catch (error) {
    logger.error(`❌ Cache delete error for key ${key}:`, error);
    return false;
  }
};

/**
 * Delete multiple keys matching pattern
 */
export const deleteCachePattern = async (pattern) => {
  try {
    if (!isRedisReady()) {
      return false;
    }

    const client = getRedisClient();
    const keys = await client.keys(pattern);

    if (keys.length > 0) {
      await client.del(keys);
      logger.debug(
        `🗑️  Deleted ${keys.length} cache keys matching: ${pattern}`
      );
    }

    return true;
  } catch (error) {
    logger.error(
      `❌ Cache pattern delete error for pattern ${pattern}:`,
      error
    );
    return false;
  }
};

/**
 * Check if key exists in cache
 */
export const cacheExists = async (key) => {
  try {
    if (!isRedisReady()) {
      return false;
    }

    const client = getRedisClient();
    const exists = await client.exists(key);
    return exists === 1;
  } catch (error) {
    logger.error(`❌ Cache exists error for key ${key}:`, error);
    return false;
  }
};

/**
 * Get cache with fallback
 * If cache miss, execute fallback function and cache the result
 */
export const getCacheOrSet = async (
  key,
  fallbackFn,
  ttl = CACHE_TTL.MEDIUM
) => {
  try {
    // Try to get from cache
    const cached = await getCache(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - execute fallback
    logger.debug(`🔄 Executing fallback for: ${key}`);
    const result = await fallbackFn();

    // Cache the result
    await setCache(key, result, ttl);

    return result;
  } catch (error) {
    logger.error(`❌ getCacheOrSet error for key ${key}:`, error);
    // If error, just return fallback result without caching
    return await fallbackFn();
  }
};

/**
 * Increment cache value
 */
export const incrementCache = async (key, amount = 1) => {
  try {
    if (!isRedisReady()) {
      return null;
    }

    const client = getRedisClient();
    const result = await client.incrBy(key, amount);
    return result;
  } catch (error) {
    logger.error(`❌ Cache increment error for key ${key}:`, error);
    return null;
  }
};

/**
 * Set cache with expiry at specific time
 */
export const setCacheExpireAt = async (key, value, timestamp) => {
  try {
    if (!isRedisReady()) {
      return false;
    }

    const client = getRedisClient();
    const stringValue = JSON.stringify(value);

    await client.set(key, stringValue);
    await client.expireAt(key, timestamp);

    logger.debug(`✅ Cache set with expireAt: ${key}`);
    return true;
  } catch (error) {
    logger.error(`❌ Cache expireAt error for key ${key}:`, error);
    return false;
  }
};

/**
 * Get remaining TTL for a key
 */
export const getCacheTTL = async (key) => {
  try {
    if (!isRedisReady()) {
      return null;
    }

    const client = getRedisClient();
    const ttl = await client.ttl(key);
    return ttl;
  } catch (error) {
    logger.error(`❌ Get TTL error for key ${key}:`, error);
    return null;
  }
};

/**
 * Flush all cache (use with caution!)
 */
export const flushAllCache = async () => {
  try {
    if (!isRedisReady()) {
      return false;
    }

    const client = getRedisClient();
    await client.flushAll();
    logger.warn("⚠️  All cache flushed!");
    return true;
  } catch (error) {
    logger.error("❌ Flush all cache error:", error);
    return false;
  }
};

export default {
  setCache,
  getCache,
  deleteCache,
  deleteCachePattern,
  cacheExists,
  getCacheOrSet,
  incrementCache,
  setCacheExpireAt,
  getCacheTTL,
  flushAllCache,
  CACHE_TTL,
  CACHE_KEYS,
};
