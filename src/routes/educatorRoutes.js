import express from "express";
import { getEducators } from "../controllers/educatorController.js";
import { getEducatorAnalytics } from "../controllers/educatorAnalyticsController.js";
import { cacheMiddleware } from "../middlewares/cache.js";
import { CACHE_TTL, CACHE_KEYS } from "../utils/cache.js";
import { protect } from "../middlewares/authMiddleware.js";
import { standardLimiter } from "../middlewares/security.js";

const router = express.Router();

// Cache key generator (query params included so filtered requests don't collide)
const educatorsListCacheKey = (req) =>
  `${CACHE_KEYS.EDUCATORS}list:${req.query.type || "all"}:${(req.query.search || "")
    .toLowerCase()
    .trim()}`;

router.get(
  "/",
  cacheMiddleware(CACHE_TTL.EDUCATORS, educatorsListCacheKey),
  getEducators
);

router.get("/:id/analytics", protect, standardLimiter, getEducatorAnalytics);

export default router;
