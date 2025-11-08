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

const router = express.Router();

// Update user profile (with avatar upload)
router.put("/update/:id", protect, upload.single("avatar"), updateUser);
// Get user by ID
router.get("/:id", protect, getUser);
// Delete user
router.delete("/:id", protect, deleteUser);

// Follow/Unfollow routes
router.post("/follow/:userId", protect, followUser);
router.delete("/unfollow/:userId", protect, unfollowUser);
router.get("/:userId/followers", protect, getFollowers);
router.get("/:userId/following", protect, getFollowing);
router.get("/:userId/followers/count", protect, getFollowersCount);
router.get("/:userId/following/count", protect, getFollowingCount);
router.get("/:userId/check-following", protect, checkIfFollowing);

// Get personalized recommendations
router.get("/recommendations", protect, getRecommendations);

// Get user statistics
router.get("/:id/stats", protect, getUserStats);

// Remove search endpoint

export default router;
