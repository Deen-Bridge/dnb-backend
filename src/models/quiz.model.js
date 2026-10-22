import mongoose from "mongoose";

/**
 * Single multiple-choice question. Each question carries an ordered array of
 * options and the index of the correct option. `correctOptionIndex`
 * is intentionally excluded from learner-facing responses before submission
 * (see quiz.service.js) so answers are never leaked to a learner who is
 * about to take the quiz.
 *
 * Note: the intended file path from issue #189 was `src/models/quiz.model.ts`,
 * but this repo is a plain-JavaScript ESM codebase (Jest `testMatch` only
 * picks up `.js`, CI `node --check`s only `.js`, and routes are `.js`), so the
 * model is authored as `.js` to keep it wired, runnable and CI-tested.
 */
const questionSchema = new mongoose.Schema(
  {
    prompt: {
      type: String,
      required: true,
      trim: true,
    },
    // Ordered multiple-choice options (standard single-correct MCQ).
    options: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 2,
        message: "A question must have at least two options",
      },
    },
    // Index into `options` that holds the correct answer (server-scored).
    correctOptionIndex: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: true }
);

const quizSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    // Optional link to the lesson subdocument the quiz gates (lessons are
    // stored as subdocuments on Course.sections[].lessons[]). A passing
    // attempt marks this lesson complete in the learner's CourseProgress.
    lessonId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Minimum percentage required to pass the quiz (0-100).
    passingScoreThreshold: {
      type: Number,
      default: 60,
      min: 0,
      max: 100,
    },
    // Optional time limit in seconds; null means unlimited.
    timeLimitSeconds: {
      type: Number,
      default: null,
      min: 0,
    },
    questions: {
      type: [questionSchema],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

quizSchema.index({ course: 1, createdAt: -1 });
quizSchema.index({ course: 1, lessonId: 1 });

export const Question = mongoose.model("Question", questionSchema);
export default mongoose.model("Quiz", quizSchema);
