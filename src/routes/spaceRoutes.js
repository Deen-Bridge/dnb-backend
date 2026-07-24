import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/upload.js";
import {
  cacheMiddleware,
  invalidateCacheMiddleware,
} from "../middlewares/cache.js";
import { CACHE_TTL, CACHE_KEYS } from "../utils/cache.js";

import {
  getSpaces,
  getSpaceById,
  createSpace,
  updateSpace,
  joinWaitList,
  deleteSpace,
  getSpacesByHost,
} from "../controllers/spaceController.js";

const router = express.Router();

// Cache key generators
const spacesListCacheKey = () => `${CACHE_KEYS.SPACES}list`;
const spaceDetailCacheKey = (req) => `${CACHE_KEYS.SPACE}${req.params.id}`;
const spacesByHostCacheKey = (req) =>
  `${CACHE_KEYS.SPACES}host:${req.params.hostId}`;

// Get all spaces - cached for 5 minutes (shorter TTL as spaces are time-sensitive)
router.get(
  "/",
  cacheMiddleware(CACHE_TTL.SPACES, spacesListCacheKey),
  getSpaces
);

// Get all spaces by host (user) - cached for 5 minutes
router.get(
  "/by-host/:hostId",
  cacheMiddleware(CACHE_TTL.SPACES, spacesByHostCacheKey),
  getSpacesByHost
);

// Get a single space by ID - cached for 5 minutes
router.get(
  "/:id",
  cacheMiddleware(CACHE_TTL.SPACES, spaceDetailCacheKey),
  getSpaceById
);

// Create a new space - invalidates spaces cache
router.post(
  "/",
  protect,
  upload.fields([{ name: "thumbnail", maxCount: 1 }]),
  invalidateCacheMiddleware([`${CACHE_KEYS.SPACES}*`]),
  createSpace
);

// Join waitlist - invalidates space cache
router.post(
  "/:id/waitlist",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.SPACE}*`]),
  joinWaitList
);

// Update a space - invalidates space caches
router.put(
  "/update/:id",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.SPACES}*`, `${CACHE_KEYS.SPACE}*`]),
  updateSpace
);

// Delete a space - invalidates space caches
router.delete(
  "/:id",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.SPACES}*`, `${CACHE_KEYS.SPACE}*`]),
  deleteSpace
);

export default router;
