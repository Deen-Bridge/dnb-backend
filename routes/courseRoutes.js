import express from "express";
import {
  createCourse,
  getCourses,
  getCourseById,
  enrollInCourse,
  getCoursesByUser,
  updateCourse,
} from "../controllers/courseController.js";
import upload from "../middlewares/upload.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getCourses);
router.get("/:id", getCourseById);

router.post(
  "/",
  protect,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  createCourse
);

// New route for getting courses by user
router.get("/user", protect, getCoursesByUser);

router.post("/:id/enroll", protect, enrollInCourse);

// 🔄 Edit/Update course
router.put(
  "/:id",
  protect,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  updateCourse
);

export default router;
