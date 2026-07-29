import express from "express";
import { searchAll } from "../controllers/searchController.js";
import { searchAll, searchEducatorsHandler } from "../controllers/searchController.js";
import { cacheMiddleware } from "../middlewares/cache.js";
import { CACHE_TTL, CACHE_KEYS } from "../utils/cache.js";

const router = express.Router();

// Cache key generator for search queries
const searchCacheKey = (req) => {
  const query = req.query.q || req.query.query || "";
  const type = req.query.type || "all";
  return `${CACHE_KEYS.SEARCH}${type}:${query.toLowerCase().trim()}`;
};

// Main search endpoint - cached for 5 minutes
router.get("/", cacheMiddleware(CACHE_TTL.SEARCH, searchCacheKey), searchAll);
  const page = req.query.page || 1;
  const limit = req.query.limit || 10;
  const filterKeys = ['minPrice', 'maxPrice', 'free', 'category', 'minRating', 'interest', 'sort'];
  const filtersStr = filterKeys.map(k => `${k}=${req.query[k] || ''}`).join('&');
  return `${CACHE_KEYS.SEARCH}${req.path}:${type}:${query.toLowerCase().trim()}:page=${page}:limit=${limit}:${filtersStr}`;
};

// Main search endpoint
router.get("/", cacheMiddleware(CACHE_TTL.SEARCH, searchCacheKey), searchAll);

// Dedicated educators endpoint
router.get("/educators", cacheMiddleware(CACHE_TTL.SEARCH, searchCacheKey), searchEducatorsHandler);

export default router;
