import express from "express";
import {
  createCourse,
  getCourses,
  getCourseById,
  enrollInCourse,
  getCoursesByUser,
  updateCourse,
  addCourseReview,
  fetchRecommendedCourses,
} from "../../controllers/courses/courseController.js";
import upload from "../../middlewares/upload.js";
import { protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", getCourses); // GET /api/courses
router.get("/user", getCoursesByUser); // ✅ GET /api/courses/user
router.get("/recom", fetchRecommendedCourses);
router.get("/:id", getCourseById); // GET /api/courses/123

router.post(
  "/",
  protect,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  createCourse
);

router.post("/:id/enroll", protect, enrollInCourse);
router.post("/:id/reviews", protect, addCourseReview);

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