/**
 * @module mongo/repositories/QuizRepository
 * Data-access layer for the {@link Quiz} model.
 * -------------------------------------------------------------------------
 * `QuizRepository` extends `BaseRepository` to inherit generic CRUD,
 * pagination, and typed error handling, then adds quiz-specific query
 * helpers: course scoping and lesson scoping.
 *
 * @example
 * import quizRepository from "../mongo/repositories/QuizRepository.js";
 *
 * const page = await quizRepository.findByCourse(courseId, { limit: 10, paginate: true });
 */

import BaseRepository from "../base/BaseRepository.js";
import Quiz from "../../src/models/quiz.model.js";

/**
 * Repository exposing Quiz-specific query helpers on top of
 * {@link BaseRepository}.
 *
 * A shared default instance is exported for convenience, while still
 * allowing `new QuizRepository(model)` for tests that inject a mock model.
 */
export class QuizRepository extends BaseRepository {
  /**
   * @param {import("mongoose").Model} [model=Quiz] The Mongoose model this
   *   repository operates on. Defaults to the real `Quiz` model; accepting it
   *   as a parameter keeps the class testable.
   */
  constructor(model = Quiz) {
    super(model);
  }

  /**
   * Fetch quizzes belonging to a course.
   *
   * @param {import("mongoose").Types.ObjectId|string} courseId Course id.
   * @param {object} [options={}] Query options forwarded to
   *   {@link BaseRepository#paginate} or {@link BaseRepository#findMany}.
   * @param {boolean} [options.paginate=false] When `true`, returns offset-paginated
   *   results via {@link BaseRepository#paginate}. Otherwise returns a plain array.
   * @param {object} [options.filter] Additional filter criteria merged into the
   *   base `{ course: courseId }` query.
   * @returns {Promise<object[]|{data: object[], total: number, ...}>} Matching
   *   quizzes, newest first by default.
   */
  async findByCourse(courseId, options = {}) {
    const { paginate: usePaginate, filter: extraFilter, ...rest } = options;
    const filter = { course: courseId, ...extraFilter };
    const defaults = { sort: { createdAt: -1 }, ...rest };

    if (usePaginate) {
      return this.paginate(filter, defaults);
    }

    return this.findMany(filter, defaults);
  }

  /**
   * Fetch the quiz gating a specific lesson within a course, if any.
   *
   * @param {import("mongoose").Types.ObjectId|string} courseId Course id.
   * @param {import("mongoose").Types.ObjectId|string} lessonId Lesson subdocument id.
   * @returns {Promise<object|null>} The matching quiz, or `null`.
   */
  async findByLesson(courseId, lessonId) {
    return this.findOne({ course: courseId, lessonId });
  }
}

/**
 * Default shared instance bound to the real `Quiz` model.
 * @type {QuizRepository}
 */
const quizRepository = new QuizRepository();

export default quizRepository;
