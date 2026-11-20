import { getCache, setCache, CACHE_TTL } from "../utils/cache.js";
import logger from "../config/logger.js";

/**
 * Cache middleware for GET requests
 * @param {number} ttl - Time to live in seconds
 * @param {function} keyGenerator - Function to generate cache key from req
 */
export const cacheMiddleware = (
  ttl = CACHE_TTL.MEDIUM,
  keyGenerator = null,
  { allowAuthenticated = false } = {}
) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== "GET") {
      return next();
    }
    if (req.user && !allowAuthenticated) {
      res.setHeader("Cache-Control", "private, no-store");
      logger.debug("cache bypass: authenticated response requires an explicit policy");
      return next();
    }

    try {
      // Generate cache key
      const cacheKey = keyGenerator
        ? keyGenerator(req)
        : `route:${req.originalUrl}`;

      // Try to get from cache
      const cachedData = await getCache(cacheKey);

      if (cachedData) {
        res.setHeader("Cache-Control", "public, max-age=" + ttl);
        logger.debug(`✅ Serving from cache: ${cacheKey}`);
        return res.status(200).json(cachedData);
      }

      // Cache miss - store original json method
      const originalJson = res.json.bind(res);

      // Override res.json to cache the response
      res.json = (data) => {
        if (containsSensitiveData(data)) {
          res.setHeader("Cache-Control", "private, no-store");
          return originalJson(data);
        }
        res.setHeader("Cache-Control", "public, max-age=" + ttl);
        // Cache the response
        setCache(cacheKey, data, ttl).catch((err) => {
          logger.error("Error caching response:", err);
        });

        // Call original json method
        return originalJson(data);
      };

      next();
    } catch (error) {
      logger.error("Cache middleware error:", error);
      next();
    }
  };
};

const SENSITIVE_KEYS = new Set(["password", "token", "secret", "refreshToken", "resetToken", "authorization", "payment"]);
const containsSensitiveData = (value, depth = 0) => {
  if (depth > 4 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveData(item, depth + 1));
  return Object.entries(value).some(([key, child]) => SENSITIVE_KEYS.has(key) || containsSensitiveData(child, depth + 1));
};

/**
 * Invalidate cache middleware
 * Clears cache for specific patterns after POST, PUT, PATCH, DELETE requests
 */
export const invalidateCacheMiddleware = (patterns) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = async (data) => {
      // Only invalidate on successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const { deleteCachePattern } = await import("../utils/cache.js");

          // Invalidate specified patterns
          for (const pattern of patterns) {
            await deleteCachePattern(pattern);
            logger.debug(`🗑️  Cache invalidated: ${pattern}`);
          }
        } catch (error) {
          logger.error("Error invalidating cache:", error);
        }
      }

      return originalJson(data);
    };

    next();
  };
};

/**
 * Smart cache middleware with automatic key generation
 */
export const smartCache = (options = {}) => {
  const {
    ttl = CACHE_TTL.MEDIUM,
    prefix = "api",
    includeQuery = true,
    includeUser = false,
    allowAuthenticated = false,
  } = options;

  return cacheMiddleware(ttl, (req) => {
    let key = `${prefix}:${req.path}`;

    // Include query params
    if (includeQuery && Object.keys(req.query).length > 0) {
      const queryString = new URLSearchParams(req.query).toString();
      key += `:${queryString}`;
    }

    // Include user ID for user-specific caching
    if (includeUser && req.user) {
      key += `:user:${req.user.id}`;
    }

    return key;
  }, { allowAuthenticated });
};

export default {
  cacheMiddleware,
  invalidateCacheMiddleware,
  smartCache,
};
