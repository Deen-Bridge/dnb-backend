import express from "express";
import { searchAll } from "../controllers/searchController.js";
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

export default router;
