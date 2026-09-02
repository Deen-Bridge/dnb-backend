import mongoose from "mongoose";

/**
 * A single learner's attempt at a specific quiz. Records which options the
 * learner selected for each question, the resulting (server-computed) score
 * and whether it met the quiz's passing threshold. Learners may attempt a
 * quiz multiple times, so one document is created per attempt and history is
 * retained for the lifetime of the attempt (per-learner, per-quiz).
 */
const answerSchema = new mongoose.Schema(
  {
    // `_id` of the Question subdocument on the Quiz.
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // Index of the option the learner selected.
    selectedOptionIndex: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const quizAttemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quiz",
      required: true,
      index: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    answers: {
      type: [answerSchema],
      default: [],
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalQuestions: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Percentage correct (0-100), server-computed.
    percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    passed: {
      type: Boolean,
      default: false,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

quizAttemptSchema.index({ user: 1, quiz: 1, submittedAt: -1 });

export default mongoose.model("QuizAttempt", quizAttemptSchema);
