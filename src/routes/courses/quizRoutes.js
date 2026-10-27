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

import { validate } from "../../middlewares/validate.js";
import {
  quizIdParamValidation,
  attemptIdParamValidation,
  courseQuizzesListValidation,
} from "../../validators/courseValidators.js";

const router = express.Router();

// Reader / learner endpoints (authenticated)
router.get("/courses/:courseId/quizzes", protect, courseQuizzesListValidation, validate, listCourseQuizzesController);
router.get("/quizzes/:quizId", protect, quizIdParamValidation, validate, getQuizController);
router.get("/quizzes/:quizId/attempts", protect, quizIdParamValidation, validate, getAttemptHistoryController);
router.post("/quizzes/:quizId/attempts", protect, quizIdParamValidation, validate, submitAttemptController);

// Post-submission result review (owner / admin enforced inside the service)
router.get("/attempts/:attemptId", protect, attemptIdParamValidation, validate, getAttemptResultController);

// Instructor / admin management endpoints
router.post("/quizzes", protect, requireVerifiedEducator, createQuizController);
router.put("/quizzes/:quizId", protect, requireVerifiedEducator, quizIdParamValidation, validate, updateQuizController);
router.delete("/quizzes/:quizId", protect, requireVerifiedEducator, quizIdParamValidation, validate, deleteQuizController);

export default router;
