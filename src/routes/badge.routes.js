import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  getUserBadgesController,
  getAllBadgesController,
  checkBadgesController,
} from "../controllers/badge.controller.js";

const router = express.Router();

// Public routes
router.get("/", getAllBadgesController);
router.get("/user/:userId", getUserBadgesController);

// Protected routes
router.get("/my-badges", protect, getUserBadgesController);
router.post("/evaluate", protect, checkBadgesController);

export default router;
