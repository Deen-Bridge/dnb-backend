import mongoose from "mongoose";
import quizRepository from "../../mongo/repositories/QuizRepository.js";
import attemptRepository from "../../mongo/repositories/QuizAttemptRepository.js";
import Course from "../models/Course.js";
import CourseProgress from "../models/CourseProgress.js";
import Quiz from "../models/quiz.model.js";
import { APIError } from "../middlewares/errorHandler.js";

/**
 * Allowed fields when creating/updating a quiz. `questions` is validated
 * separately so correct answers can be scrubbed from learner payloads.
 */
const QUIZ_INPUT_FIELDS = [
  "title",
  "description",
  "course",
  "lessonId",
  "passingScoreThreshold",
  "timeLimitSeconds",
  "questions",
];

const objectId = (value) => new mongoose.Types.ObjectId(value);

const isValidId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * Role guard used by the controller: only admins and verified educators
 * may create/update/delete quizzes.
 */
export const canManageQuiz = (user) => {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.verifiedEducator === true;
};

/**
 * Verify the requester is allowed to manage a given quiz (owner or admin).
 * Mirrors the course ownership convention (Course.createdBy === user.id || admin).
 */
export async function assertCanManageQuiz(user, quiz) {
  if (user?.role === "admin") return;
  if (quiz.createdBy?.toString() === user?._id?.toString()) return;
  throw new APIError("You are not authorized to modify this quiz", 403);
}

/**
 * Validate that the quiz's `course` exists and, when a `lessonId` is supplied,
 * that id references a real lesson subdocument. Also verifies that an
 * instructor who is not an admin owns the course (can only attach quizzes to
 * their own courses).
 */
async function validateCourseAndLesson({ course, lessonId, user }) {
  if (!isValidId(course)) {
    throw new APIError("A valid course id is required", 400);
  }
  const courseDoc = await Course.findById(course).lean();
  if (!courseDoc) {
    throw new APIError("Course not found", 404);
  }
  if (user?.role !== "admin" && courseDoc.createdBy?.toString() !== user?._id?.toString()) {
    throw new APIError("You are not authorized to add quizzes to this course", 403);
  }

  if (lessonId) {
    if (!isValidId(lessonId)) {
      throw new APIError("A valid lesson id is required", 400);
    }
    const lessons = (courseDoc.sections || []).flatMap((s) => s.lessons || []);
    const exists = lessons.some((l) => l._id?.toString() === String(lessonId));
    if (!exists) {
      throw new APIError("Lesson not found in this course", 400);
    }
  }
  return courseDoc;
}

/**
 * Normalize and validate the questions array. Returns the validated array
 * (each question with a `correctOptionIndex` that stays within bounds).
 */
function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new APIError("At least one question is required", 400);
  }
  return questions.map((q, i) => {
    if (!q || typeof q !== "object") {
      throw new APIError(`Question at index ${i} is invalid`, 400);
    }
    if (!q.prompt || typeof q.prompt !== "string") {
      throw new APIError(`Question ${i + 1}: prompt is required`, 400);
    }
    if (!Array.isArray(q.options) || q.options.length < 2) {
      throw new APIError(`Question ${i + 1}: at least two options are required`, 400);
    }
    const correct = q.correctOptionIndex;
    if (
      !Number.isInteger(correct) ||
      correct < 0 ||
      correct >= q.options.length
    ) {
      throw new APIError(
        `Question ${i + 1}: correctOptionIndex must point to one of the options`,
        400
      );
    }
    return {
      prompt: q.prompt,
      options: q.options.map((o) => String(o)),
      correctOptionIndex: correct,
    };
  });
}

/**
 * Strip the correct answers from a quiz payload that is destined for a
 * learner who is about to take it (correct answers must never be exposed
 * before submission).
 */
function toLearnerFacingQuiz(quiz) {
  const doc = quiz.toObject ? quiz.toObject() : { ...quiz };
  return {
    ...doc,
    questions: (doc.questions || []).map(({ correctOptionIndex, ...q }) => q),
  };
}

/**
 * Score a submitted attempt against the quiz's questions entirely on the
 * server. The client-supplied score (if any) is ignored.
 *
 * @returns {{answers, score, totalQuestions, percentage, passed}}
 */
function scoreAttempt(quiz, submittedAnswers) {
  const questions = quiz.questions || [];
  if (questions.length === 0) {
    throw new APIError("This quiz has no questions", 400);
  }

  const byQuestionId = new Map();
  for (const a of Array.isArray(submittedAnswers) ? submittedAnswers : []) {
    if (a && a.questionId && Number.isInteger(a.selectedOptionIndex)) {
      byQuestionId.set(String(a.questionId), a.selectedOptionIndex);
    }
  }

  const answers = [];
  let score = 0;
  for (const question of questions) {
    const selected = byQuestionId.get(String(question._id));
    const isCorrect =
      Number.isInteger(selected) && selected === question.correctOptionIndex;
    if (isCorrect) score += 1;
    // Only record questions the learner actually answered (keeps the attempt
    // payload lean and avoids storing null selections).
    if (Number.isInteger(selected)) {
      answers.push({
        questionId: question._id,
        selectedOptionIndex: selected,
      });
    }
  }

  const totalQuestions = questions.length;
  const percentage = totalQuestions
    ? Math.round((score / totalQuestions) * 100)
    : 0;
  const passed =
    percentage >= (quiz.passingScoreThreshold ?? 60);

  return { answers, score, totalQuestions, percentage, passed };
}

/**
 * Wire a passing attempt into the learner's course progress so the quiz
 * actually gates lesson completion (the "minimum passing score to proceed"
 * requirement). Mirrors `updateCourseProgress` in the analytics controller:
 * the quiz's lesson is added to `CourseProgress.lessonsCompleted` and the
 * percent is recomputed (completing the course at 100%).
 */
async function completeLesson(userId, courseId, lessonId) {
  if (!lessonId) return null;

  const course = await Course.findById(courseId).lean();
  if (!course) return null;

  const lessons = (course.sections || []).flatMap((s) => s.lessons || []);
  const totalLessons = lessons.length;
  if (totalLessons === 0) return null;

  const objectLessonId = objectId(lessonId);
  const existing = await CourseProgress.findOne({
    user: userId,
    course: courseId,
  });
  const completed = new Set(
    (existing?.lessonsCompleted || []).map((id) => id.toString())
  );
  completed.add(objectLessonId.toString());

  const percentComplete = Math.min(
    100,
    Math.round((completed.size / totalLessons) * 100)
  );

  const progress = await CourseProgress.findOneAndUpdate(
    { user: userId, course: courseId },
    {
      $set: {
        lessonsCompleted: Array.from(completed).map((v) => objectId(v)),
        lastLesson: objectLessonId,
        percentComplete,
        completedAt: percentComplete >= 100 ? new Date() : null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return progress;
}

/**
 * Create a new quiz (admin / verified educator, course owner).
 */
export async function createQuiz(user, data) {
  if (!canManageQuiz(user)) {
    throw new APIError("Forbidden: only verified educators and admins can create quizzes", 403);
  }

  const questions = validateQuestions(data.questions);
  const payload = {};
  for (const field of QUIZ_INPUT_FIELDS) {
    if (data[field] !== undefined) payload[field] = data[field];
  }

  await validateCourseAndLesson({
    course: payload.course,
    lessonId: payload.lessonId,
    user,
  });

  const threshold = Number(payload.passingScoreThreshold);
  if (payload.passingScoreThreshold !== undefined && (Number.isNaN(threshold) || threshold < 0 || threshold > 100)) {
    throw new APIError("passingScoreThreshold must be a number between 0 and 100", 400);
  }

  return quizRepository.create({
    title: payload.title,
    description: payload.description ?? "",
    course: payload.course,
    lessonId: payload.lessonId ?? null,
    passingScoreThreshold: threshold,
    timeLimitSeconds: payload.timeLimitSeconds ?? null,
    questions,
    createdBy: user._id,
  });
}

/**
 * Update an existing quiz (admin or quiz owner).
 */
export async function updateQuiz(user, quizId, data) {
  const quiz = await quizRepository.findById(quizId);
  if (!quiz) throw new APIError("Quiz not found", 404);
  await assertCanManageQuiz(user, quiz);

  const patch = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.passingScoreThreshold !== undefined) {
    const t = Number(data.passingScoreThreshold);
    if (Number.isNaN(t) || t < 0 || t > 100) {
      throw new APIError("passingScoreThreshold must be a number between 0 and 100", 400);
    }
    patch.passingScoreThreshold = t;
  }
  if (data.timeLimitSeconds !== undefined) patch.timeLimitSeconds = data.timeLimitSeconds;
  if (data.questions !== undefined) {
    patch.questions = validateQuestions(data.questions);
  }

  // lessonId changes must still point at a real lesson in the same course.
  const newLessonId =
    data.lessonId !== undefined ? data.lessonId : quiz.lessonId;
  await validateCourseAndLesson({
    course: quiz.course,
    lessonId: newLessonId,
    user,
  });
  if (data.lessonId !== undefined) patch.lessonId = data.lessonId;

  const updated = await quizRepository.update(quizId, patch);
  return updated;
}

/**
 * Delete a quiz (admin or quiz owner).
 */
export async function deleteQuiz(user, quizId) {
  const quiz = await quizRepository.findById(quizId);
  if (!quiz) throw new APIError("Quiz not found", 404);
  await assertCanManageQuiz(user, quiz);
  await quizRepository.delete(quizId);
  // Attempts are retained as an audit/safety record but are now orphaned;
  // they are never returned without the quiz, so leaving them is harmless.
  return { id: quizId };
}

/**
 * Fetch a quiz ready for a learner to take. Correct answers are stripped so
 * they cannot be seen before the learner submits an attempt.
 */
export async function getQuizForLearner(quizId) {
  const quiz = await quizRepository.findById(quizId, { lean: true });
  if (!quiz) throw new APIError("Quiz not found", 404);
  return toLearnerFacingQuiz(quiz);
}

/**
 * List quizzes for a course (with correct answers removed for learners).
 */
export async function listQuizzesByCourse(courseId, options = {}) {
  if (!isValidId(courseId)) throw new APIError("Invalid course id", 400);
  const page = await quizRepository.findByCourse(courseId, {
    paginate: true,
    page: options.page,
    limit: options.limit,
  });
  return page;
}

/**
 * Submit a learner's attempt. Answers are scored server-side and the
 * resulting score can never be overridden by the client. On a passing
 * attempt, the quiz's lesson is marked complete in the learner's course
 * progress.
 */
export async function submitAttempt(user, quizId, submittedAnswers) {
  const quiz = await quizRepository.findById(quizId);
  if (!quiz) throw new APIError("Quiz not found", 404);

  const result = scoreAttempt(quiz, submittedAnswers || []);
  const attempt = await attemptRepository.create({
    user: user._id,
    quiz: quizId,
    course: quiz.course,
    answers: result.answers,
    score: result.score,
    totalQuestions: result.totalQuestions,
    percentage: result.percentage,
    passed: result.passed,
  });

  let progress = null;
  if (result.passed) {
    progress = await completeLesson(user._id, quiz.course, quiz.lessonId);
  }

  return { attempt, progress };
}

/**
 * Build the post-submission result payload for a single attempt, including
 * the correct answers for review. Only the attempt owner (or an admin) may
 * view a result.
 */
export async function getAttemptResult(user, attemptId) {
  if (!isValidId(attemptId)) throw new APIError("Invalid attempt id", 400);
  const attempt = await attemptRepository.findById(attemptId, { lean: true });
  if (!attempt) throw new APIError("Attempt not found", 404);

  if (user?.role !== "admin" && attempt.user?.toString() !== user?._id?.toString()) {
    throw new APIError("You are not authorized to view this attempt", 403);
  }

  const quiz = await quizRepository.findById(attempt.quiz, { lean: true });
  if (!quiz) throw new APIError("Quiz not found", 404);

  // Merge each submitted answer with the correct answer + the learner's pick
  // for a reviewable, post-submission result.
  const byQuestionId = new Map(
    (quiz.questions || []).map((q) => [String(q._id), q])
  );
  const results = (attempt.answers || []).map((a) => {
    const question = byQuestionId.get(String(a.questionId));
    const correct = question ? question.correctOptionIndex : null;
    const isCorrect =
      correct !== null && a.selectedOptionIndex === correct;
    return {
      questionId: a.questionId,
      prompt: question ? question.prompt : a.questionId,
      options: question ? question.options : [],
      selectedOptionIndex: a.selectedOptionIndex,
      correctOptionIndex: correct,
      isCorrect,
    };
  });

  return {
    attempt,
    results,
  };
}

/**
 * Retrieve a learner's attempt history for a quiz (score/pass per attempt,
 * without revealing correct answers for already-taken attempts unless the
 * individual results endpoint is used).
 */
export async function getAttemptHistory(user, quizId) {
  if (!isValidId(quizId)) throw new APIError("Invalid quiz id", 400);
  const attempts = await attemptRepository.findHistory(user._id, quizId, {
    lean: true,
  });
  return attempts;
}

/** Re-export repository helpers for external callers/tests. */
export { quizRepository, attemptRepository };
