import express from "express";
import {
  createCourse,
  getCourses,
  getCourseById,
  enrollInCourse, // ✅ no need for a separate import
} from "../controllers/courseController.js";
import upload from "../middlewares/upload.js"; // ✅ import the upload middleware
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Public routes
router.get("/", getCourses);
router.get("/:id", getCourseById);

// Protected routes
router.post(
  "/",
  protect,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  createCourse
);
router.post("/:id/enroll", protect, enrollInCourse);

export default router;
