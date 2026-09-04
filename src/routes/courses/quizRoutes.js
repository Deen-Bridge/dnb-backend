import express from "express";
import { protect, requireVerifiedEducator } from "../../middlewares/authMiddleware.js";
import {
  createQuizController,
  updateQuizController,
  deleteQuizController,
  getQuizController,
  listCourseQuizzesController,
  submitAttemptController,
  getAttemptResultController,
  getAttemptHistoryController,
} from "../../controllers/quiz.controller.js";

const router = express.Router();

// Reader / learner endpoints (authenticated)
router.get("/courses/:courseId/quizzes", protect, listCourseQuizzesController);
router.get("/quizzes/:quizId", protect, getQuizController);
router.get("/quizzes/:quizId/attempts", protect, getAttemptHistoryController);
router.post("/quizzes/:quizId/attempts", protect, submitAttemptController);

// Post-submission result review (owner / admin enforced inside the service)
router.get("/attempts/:attemptId", protect, getAttemptResultController);

// Instructor / admin management endpoints
router.post("/quizzes", protect, requireVerifiedEducator, createQuizController);
router.put("/quizzes/:quizId", protect, requireVerifiedEducator, updateQuizController);
router.delete("/quizzes/:quizId", protect, requireVerifiedEducator, deleteQuizController);

export default router;
