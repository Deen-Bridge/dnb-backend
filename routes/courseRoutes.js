import express from "express";
import {
  createCourse,
  getCourses,
  getCourseById,
  enrollInCourse, // ✅ no need for a separate import
} from "../controllers/courseController.js";

import { protect } from  "../middlewares/authMiddleware.js";

const router = express.Router();

// Public routes
router.get("/", getCourses);
router.get("/:id", getCourseById);

// Protected routes
router.post("/", createCourse);
router.post("/:id/enroll", protect, enrollInCourse);

export default router;
