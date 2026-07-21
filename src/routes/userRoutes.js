import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/upload.js";
import {
  updateUser,
  getUser,
  deleteUser,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  getFollowersCount,
  getFollowingCount,
  checkIfFollowing,
  getRecommendations,
  getUserStats,
} from "../controllers/userController.js";
import { searchAll } from "../controllers/searchController.js";
import {
  cacheMiddleware,
  invalidateCacheMiddleware,
} from "../middlewares/cache.js";
import { CACHE_TTL, CACHE_KEYS } from "../utils/cache.js";

const router = express.Router();

// Cache key generators
const userCacheKey = (req) => `${CACHE_KEYS.USER}${req.params.id}`;
const userStatsCacheKey = (req) => `${CACHE_KEYS.USER}${req.params.id}:stats`;
const followersCacheKey = (req) =>
  `${CACHE_KEYS.USER}${req.params.userId}:followers`;
const followingCacheKey = (req) =>
  `${CACHE_KEYS.USER}${req.params.userId}:following`;

// Get personalized recommendations - cached for 10 minutes (must be before /:id)
router.get(
  "/recommendations",
  protect,
  cacheMiddleware(CACHE_TTL.USERS, (req) =>
    `${CACHE_KEYS.USER}${req.user._id}:recommendations`
  ),
  getRecommendations
);

// Update user profile (with avatar upload) - invalidates user cache
router.put(
  "/update/:id",
  protect,
  upload.single("avatar"),
  invalidateCacheMiddleware([`${CACHE_KEYS.USER}*`]),
  updateUser
);

// Get user by ID - cached for 10 minutes
router.get(
  "/:id",
  protect,
  cacheMiddleware(CACHE_TTL.USERS, userCacheKey),
  getUser
);

// Delete user - invalidates user cache
router.delete(
  "/:id",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.USER}*`]),
  deleteUser
);

// Follow/Unfollow routes - invalidates follower/following caches
router.post(
  "/follow/:userId",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.USER}*:followers`, `${CACHE_KEYS.USER}*:following`]),
  followUser
);
router.delete(
  "/unfollow/:userId",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.USER}*:followers`, `${CACHE_KEYS.USER}*:following`]),
  unfollowUser
);

// Get followers/following - cached for 10 minutes
router.get(
  "/:userId/followers",
  protect,
  cacheMiddleware(CACHE_TTL.USERS, followersCacheKey),
  getFollowers
);
router.get(
  "/:userId/following",
  protect,
  cacheMiddleware(CACHE_TTL.USERS, followingCacheKey),
  getFollowing
);
router.get(
  "/:userId/followers/count",
  protect,
  cacheMiddleware(CACHE_TTL.USERS, (req) =>
    `${CACHE_KEYS.USER}${req.params.userId}:followers:count`
  ),
  getFollowersCount
);
router.get(
  "/:userId/following/count",
  protect,
  cacheMiddleware(CACHE_TTL.USERS, (req) =>
    `${CACHE_KEYS.USER}${req.params.userId}:following:count`
  ),
  getFollowingCount
);
router.get("/:userId/check-following", protect, checkIfFollowing);

// Get user statistics - cached for 10 minutes
router.get(
  "/:id/stats",
  protect,
  cacheMiddleware(CACHE_TTL.USERS, userStatsCacheKey),
  getUserStats
);

export default router;
