import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { uploadImage } from "../middlewares/upload.js";
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
  getLearningDashboard,
} from "../controllers/userController.js";
import { searchAll } from "../controllers/searchController.js";
import { getUserBadgesController } from "../controllers/badge.controller.js";
import completionRoutes, {
  getUserCompletion,
} from "./api/users/completion.js";
import preferencesRoutes from "./api/users/preferences.js";
import {
  cacheMiddleware,
  invalidateCacheMiddleware,
} from "../middlewares/cache.js";
import { CACHE_TTL, CACHE_KEYS } from "../utils/cache.js";
import { exportMyData } from "../controllers/gdprExportController.js";
import { idempotency } from "../middlewares/idempotency.js";
import {
  createPrivacyRequest,
  downloadPrivacyExport,
  getPrivacyRequest,
  retryPrivacyRequest,
} from "../services/privacyWorkflowService.js";

const router = express.Router();

// Cache key generators
const userCacheKey = (req) => `${CACHE_KEYS.USER}${req.params.id}`;
const userStatsCacheKey = (req) => `${CACHE_KEYS.USER}${req.params.id}:stats`;
const followersCacheKey = (req) =>
  `${CACHE_KEYS.USER}${req.params.userId}:followers`;
const followingCacheKey = (req) =>
  `${CACHE_KEYS.USER}${req.params.userId}:following`;

// GDPR data export for the authenticated account.
router.get("/me/export", protect, exportMyData);

router.post("/me/privacy-requests", protect, idempotency({ required: true }), async (req, res, next) => {
  try {
    const type = req.body?.type;
    if (!["export", "delete"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be export or delete" });
    }
    const result = await createPrivacyRequest({
      userId: req.user._id,
      type,
      requestKey: req.headers["idempotency-key"] || req.headers["x-idempotency-key"],
      req,
    });
    return res.status(202).json({
      success: true,
      requestId: result.request._id,
      type: result.request.type,
      status: result.request.status,
      progress: result.request.progress,
      expiresAt: result.request.archive?.expiresAt || null,
      downloadToken: result.downloadToken || undefined,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me/privacy-requests/:requestId/download", protect, async (req, res, next) => {
  try {
    const data = await downloadPrivacyExport({
      userId: req.user._id,
      requestId: req.params.requestId,
      token: req.get("x-export-token"),
    });
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get("/me/privacy-requests/:requestId", protect, async (req, res, next) => {
  try {
    const request = await getPrivacyRequest({ userId: req.user._id, requestId: req.params.requestId });
    if (!request) return res.status(404).json({ success: false, message: "Privacy request not found" });
    return res.json({
      success: true,
      request: {
        id: request._id,
        type: request.type,
        status: request.status,
        progress: request.progress,
        completedSteps: request.completedSteps,
        failedSteps: request.failedSteps,
        error: request.error,
        expiresAt: request.archive?.expiresAt || null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/me/privacy-requests/:requestId/retry", protect, idempotency({ required: true }), async (req, res, next) => {
  try {
    const request = await retryPrivacyRequest({ userId: req.user._id, requestId: req.params.requestId, req });
    return res.json({ success: true, requestId: request._id, status: request.status, progress: request.progress });
  } catch (error) {
    return next(error);
  }
});

// User preferences routes (must be before /:id)
router.use("/me/preferences", preferencesRoutes);
router.use("/preferences", preferencesRoutes);

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
  (req, res, next) => {
    if (req.user.role !== "admin" && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ success: false, message: "Not authorized to update this profile", data: null });
    }
    next();
  },
  uploadImage.single("avatar"),
  invalidateCacheMiddleware([`${CACHE_KEYS.USER}*`]),
  updateUser
);

// Profile completion routes (must be before /:id)
router.use("/completion", completionRoutes);

// Fetch user badges
router.get("/:userId/badges", protect, getUserBadgesController);

// Fetch user profile completion
router.get("/:userId/completion", protect, getUserCompletion);

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
  (req, res, next) => {
    if (req.user.role !== "admin" && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this user", data: null });
    }
    next();
  },
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
router.get("/me/learning", protect, getLearningDashboard);

export default router;
