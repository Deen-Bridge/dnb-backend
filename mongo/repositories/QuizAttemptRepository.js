/**
 * @module mongo/repositories/QuizAttemptRepository
 * Data-access layer for the {@link QuizAttempt} model.
 * -------------------------------------------------------------------------
 * `QuizAttemptRepository` extends `BaseRepository` to inherit generic CRUD,
 * pagination, and typed error handling, then adds attempt-specific query
 * helpers: per-user/per-quiz scoping and attempt history.
 *
 * @example
 * import quizAttemptRepository from "../mongo/repositories/QuizAttemptRepository.js";
 *
 * const history = await quizAttemptRepository.findHistory(userId, quizId);
 */

import BaseRepository from "../base/BaseRepository.js";
import QuizAttempt from "../../src/models/quiz-attempt.model.js";

/**
 * Repository exposing QuizAttempt-specific query helpers on top of
 * {@link BaseRepository}.
 *
 * A shared default instance is exported for convenience, while still
 * allowing `new QuizAttemptRepository(model)` for tests that inject a mock
 * model.
 */
export class QuizAttemptRepository extends BaseRepository {
  /**
   * @param {import("mongoose").Model} [model=QuizAttempt] The Mongoose model
   *   this repository operates on. Defaults to the real `QuizAttempt` model;
   *   accepting it as a parameter keeps the class testable.
   */
  constructor(model = QuizAttempt) {
    super(model);
  }

  /**
   * Fetch all attempts a learner has made on a quiz, newest first.
   *
   * @param {import("mongoose").Types.ObjectId|string} userId Learner id.
   * @param {import("mongoose").Types.ObjectId|string} quizId Quiz id.
   * @param {object} [options={}] Query options forwarded to
   *   {@link BaseRepository#findMany}.
   * @returns {Promise<object[]>} Attempt history (possibly empty).
   */
  async findHistory(userId, quizId, options = {}) {
    const { filter: extraFilter, ...rest } = options;
    const filter = { user: userId, quiz: quizId, ...extraFilter };
    const defaults = { sort: { submittedAt: -1 }, ...rest };
    return this.findMany(filter, defaults);
  }

  /**
   * Fetch a learner's most recent attempt on a quiz, if any.
   *
   * @param {import("mongoose").Types.ObjectId|string} userId Learner id.
   * @param {import("mongoose").Types.ObjectId|string} quizId Quiz id.
   * @returns {Promise<object|null>} The latest attempt, or `null`.
   */
  async findLatest(userId, quizId) {
    return this.findOne({ user: userId, quiz: quizId }, { sort: { submittedAt: -1 } });
  }
}

/**
 * Default shared instance bound to the real `QuizAttempt` model.
 * @type {QuizAttemptRepository}
 */
const quizAttemptRepository = new QuizAttemptRepository();

export default quizAttemptRepository;
