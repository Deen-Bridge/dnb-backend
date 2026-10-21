import { catchAsync } from "../middlewares/errorHandler.js";
import {
  createQuiz,
  updateQuiz,
  deleteQuiz,
  getQuizForLearner,
  listQuizzesByCourse,
  submitAttempt,
  getAttemptResult,
  getAttemptHistory,
} from "../services/quiz.service.js";

/**
 * @route   POST /api/quizzes
 * @desc    Create a quiz (admin / verified educator, course owner)
 * @access  Private (verified educator / admin)
 */
export const createQuizController = catchAsync(async (req, res, next) => {
  const quiz = await createQuiz(req.user, req.body);
  res.status(201).json({
    success: true,
    message: "Quiz created successfully",
    data: quiz,
  });
});

/**
 * @route   PUT /api/quizzes/:quizId
 * @desc    Update a quiz (admin / quiz owner)
 * @access  Private (verified educator / admin)
 */
export const updateQuizController = catchAsync(async (req, res, next) => {
  const quiz = await updateQuiz(req.user, req.params.quizId, req.body);
  res.status(200).json({
    success: true,
    message: "Quiz updated successfully",
    data: quiz,
  });
});

/**
 * @route   DELETE /api/quizzes/:quizId
 * @desc    Delete a quiz (admin / quiz owner)
 * @access  Private (verified educator / admin)
 */
export const deleteQuizController = catchAsync(async (req, res, next) => {
  const result = await deleteQuiz(req.user, req.params.quizId);
  res.status(200).json({
    success: true,
    message: "Quiz deleted successfully",
    data: result,
  });
});

/**
 * @route   GET /api/quizzes/:quizId
 * @desc    Fetch a quiz for a learner to take (correct answers hidden)
 * @access  Private
 */
export const getQuizController = catchAsync(async (req, res, next) => {
  const quiz = await getQuizForLearner(req.params.quizId);
  res.status(200).json({
    success: true,
    message: "Quiz fetched successfully",
    data: quiz,
  });
});

/**
 * @route   GET /api/courses/:courseId/quizzes
 * @desc    List quizzes for a course
 * @access  Private
 */
export const listCourseQuizzesController = catchAsync(async (req, res, next) => {
  const page = await listQuizzesByCourse(req.params.courseId, {
    page: req.query.page,
    limit: req.query.limit,
  });
  res.status(200).json({
    success: true,
    message: "Quizzes fetched successfully",
    ...page,
  });
});

/**
 * @route   POST /api/quizzes/:quizId/attempts
 * @desc    Submit a learner's attempt; server-scored with pass/fail and
 *          lesson-completion wiring on a pass
 * @access  Private
 */
export const submitAttemptController = catchAsync(async (req, res, next) => {
  const { attempt, progress } = await submitAttempt(
    req.user,
    req.params.quizId,
    req.body.answers
  );
  res.status(201).json({
    success: true,
    message: "Attempt submitted successfully",
    data: { attempt, progress },
  });
});

/**
 * @route   GET /api/attempts/:attemptId
 * @desc    Retrieve a specific attempt result including correct answers
 *          (post-submission review; owner or admin only)
 * @access  Private
 */
export const getAttemptResultController = catchAsync(async (req, res, next) => {
  const result = await getAttemptResult(req.user, req.params.attemptId);
  res.status(200).json({
    success: true,
    message: "Attempt result fetched successfully",
    data: result,
  });
});

/**
 * @route   GET /api/quizzes/:quizId/attempts
 * @desc    Retrieve a learner's attempt history for a quiz
 * @access  Private
 */
export const getAttemptHistoryController = catchAsync(async (req, res, next) => {
  const attempts = await getAttemptHistory(req.user, req.params.quizId);
  res.status(200).json({
    success: true,
    message: "Attempt history fetched successfully",
    data: attempts,
  });
});
