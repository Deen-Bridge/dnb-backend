import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  createBundle,
  getBundles,
  getBundleById,
  getBundlesByCourse,
  updateBundle,
  deleteBundle,
  purchaseBundle,
} from "../controllers/course-bundle.controller.js";

const router = express.Router();

// Public routes
router.get("/", getBundles);
router.get("/course/:courseId", getBundlesByCourse);
router.get("/:id", getBundleById);

// Protected routes
router.post("/", protect, createBundle);
router.put("/:id", protect, updateBundle);
router.delete("/:id", protect, deleteBundle);
router.post("/:id/purchase", protect, purchaseBundle);

export default router;
