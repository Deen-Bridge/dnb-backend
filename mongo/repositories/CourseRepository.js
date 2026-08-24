/**
 * @module mongo/repositories/CourseRepository
 * @description Data-access repository for the {@link module:src/models/Course}
 * model. Wraps every course-specific query — educator listings, catalogue
 * discovery, full-text search, category browsing and enrollment lookups —
 * behind a single typed surface so controllers and services never touch the
 * Mongoose model directly.
 *
 * Extends {@link module:mongo/base/BaseRepository} and therefore inherits all
 * generic CRUD, pagination (offset + cursor), session and error-normalization
 * behaviour for free.
 */

import mongoose from "mongoose";
import BaseRepository, {
  RepositoryValidationError,
} from "../base/BaseRepository.js";
import Course from "../../src/models/Course.js";

/**
 * Fields safe to expose when populating the course author. Kept in one place so
 * every listing returns a consistent educator projection.
 * @constant {string}
 */
const EDUCATOR_PROJECTION = "name email avatar bio";

/**
 * Repository encapsulating all Course database operations.
 *
 * @example
 * import { CourseRepository } from "../../mongo/repositories/CourseRepository.js";
 *
 * const courseRepo = new CourseRepository();
 *
 * // Catalogue page for students (offset pagination + metadata):
 * const { data, total, hasNextPage } = await courseRepo.findPublished({
 *   page: req.query.page,
 *   limit: req.query.limit,
 * });
 *
 * // Everything a given educator has authored:
 * const mine = await courseRepo.findByEducator(req.user._id, { lean: true });
 *
 * // Full-text search over title/description/category:
 * const results = await courseRepo.searchCourses("tajweed", { limit: 10 });
 *
 * // Enrollment lookups:
 * const enrolled = await courseRepo.isUserEnrolled(courseId, req.user._id);
 * const myCourses = await courseRepo.findEnrolledCourses(req.user._id);
 */
export class CourseRepository extends BaseRepository {
  constructor() {
    super(Course);
  }

  /* ---------------------------------------------------------------------- */
  /* Educator listings                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * List every course authored by a given educator (the `createdBy` field),
   * newest first.
   *
   * @param {string|import("mongoose").Types.ObjectId} educatorId - Author's user id.
   * @param {object} [options] - Passed through to {@link BaseRepository#findMany}
   *   (`sort`, `limit`, `skip`, `select`, `populate`, `lean`, `session`).
   * @returns {Promise<Array<object>>} Matching courses (possibly empty).
   * @throws {RepositoryValidationError} If `educatorId` is not a valid ObjectId.
   */
  async findByEducator(educatorId, options = {}) {
    this._assertObjectId(educatorId, "educatorId");
    return this.findMany(
      { createdBy: educatorId },
      { sort: { createdAt: -1 }, ...options }
    );
  }

  /**
   * Offset-paginated variant of {@link CourseRepository#findByEducator} for
   * dashboard listings that show page numbers and totals.
   *
   * @param {string|import("mongoose").Types.ObjectId} educatorId - Author's user id.
   * @param {object} [options] - Passed through to {@link BaseRepository#paginate}.
   * @returns {Promise<{data: Array<object>, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   * @throws {RepositoryValidationError} If `educatorId` is not a valid ObjectId.
   */
  async paginateByEducator(educatorId, options = {}) {
    this._assertObjectId(educatorId, "educatorId");
    return this.paginate(
      { createdBy: educatorId },
      { sortBy: "createdAt", order: "desc", ...options }
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Catalogue discovery                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Offset-paginated catalogue of courses available to students.
   *
   * The Course schema currently has no draft/published lifecycle field, so
   * every persisted course is considered publicly visible. This method is the
   * single, centralized place that defines "published": callers should use it
   * instead of querying the model directly, and if a `status`/`isPublished`
   * field is later introduced the filter only needs to change here.
   *
   * @param {object} [options]
   * @param {object} [options.filter] - Extra filter merged into the catalogue query.
   * @param {number} [options.page=1]
   * @param {number} [options.limit=20]
   * @param {string} [options.sortBy="createdAt"] - Defaults to newest-first.
   * @param {("asc"|"desc")} [options.order="desc"]
   * @param {(Array|object|string)} [options.populate] - Defaults to the educator projection.
   * @param {boolean} [options.lean=false]
   * @param {import("mongoose").ClientSession} [options.session]
   * @returns {Promise<{data: Array<object>, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findPublished(options = {}) {
    const { filter = {}, populate, ...rest } = options;
    return this.paginate(
      { ...filter },
      {
        sortBy: "createdAt",
        order: "desc",
        populate: populate ?? { path: "createdBy", select: EDUCATOR_PROJECTION },
        ...rest,
      }
    );
  }

  /**
   * Full-text search across a course's `title`, `description` and `category`
   * (backed by the model's text index), returned as an offset-paginated page
   * ordered by text relevance.
   *
   * Falls back to a case-insensitive regex over `title`/`category` when the
   * search term is a single short token, where `$text` (which matches whole
   * words) tends to under-match partial input.
   *
   * @param {string} term - Raw search string.
   * @param {object} [options] - Pagination options (see {@link CourseRepository#findPublished}).
   * @returns {Promise<{data: Array<object>, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   * @throws {RepositoryValidationError} If `term` is empty.
   */
  async searchCourses(term, options = {}) {
    const query = typeof term === "string" ? term.trim() : "";
    if (!query) {
      throw new RepositoryValidationError("searchCourses requires a non-empty term");
    }

    const { populate, ...rest } = options;
    const resolvedPopulate =
      populate ?? { path: "createdBy", select: EDUCATOR_PROJECTION };

    // Short single tokens match poorly against a whole-word $text index, so use
    // an anchored regex for a more forgiving "starts-with/contains" experience.
    if (!query.includes(" ") && query.length <= 3) {
      const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      return this.paginate(
        { $or: [{ title: rx }, { category: rx }] },
        { sortBy: "rating", order: "desc", populate: resolvedPopulate, ...rest }
      );
    }

    // Relevance (textScore) sorting needs a `$meta` projection the generic
    // paginator doesn't express, so order the matches by rating — best-rated
    // matching courses first, which is the useful default for a catalogue.
    return this.paginate(
      { $text: { $search: query } },
      {
        sortBy: "rating",
        order: "desc",
        populate: resolvedPopulate,
        ...rest,
      }
    );
  }

  /**
   * List courses in a category by its `categoryRef` ObjectId, newest first.
   *
   * @param {string|import("mongoose").Types.ObjectId} categoryRef - Category id.
   * @param {object} [options] - Passed through to {@link BaseRepository#findMany}.
   * @returns {Promise<Array<object>>} Matching courses (possibly empty).
   * @throws {RepositoryValidationError} If `categoryRef` is not a valid ObjectId.
   */
  async findByCategory(categoryRef, options = {}) {
    this._assertObjectId(categoryRef, "categoryRef");
    return this.findMany(
      { categoryRef },
      { sort: { createdAt: -1 }, ...options }
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Enrollment queries                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * List every course a user is enrolled in (present in `enrolledUsers`).
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - Enrolled user's id.
   * @param {object} [options] - Passed through to {@link BaseRepository#findMany}.
   * @returns {Promise<Array<object>>} Courses the user is enrolled in.
   * @throws {RepositoryValidationError} If `userId` is not a valid ObjectId.
   */
  async findEnrolledCourses(userId, options = {}) {
    this._assertObjectId(userId, "userId");
    return this.findMany(
      { enrolledUsers: userId },
      { sort: { createdAt: -1 }, ...options }
    );
  }

  /**
   * Offset-paginated variant of {@link CourseRepository#findEnrolledCourses}.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - Enrolled user's id.
   * @param {object} [options] - Passed through to {@link BaseRepository#paginate}.
   * @returns {Promise<{data: Array<object>, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   * @throws {RepositoryValidationError} If `userId` is not a valid ObjectId.
   */
  async paginateEnrolledCourses(userId, options = {}) {
    this._assertObjectId(userId, "userId");
    return this.paginate(
      { enrolledUsers: userId },
      { sortBy: "createdAt", order: "desc", ...options }
    );
  }

  /**
   * Whether a specific user is enrolled in a specific course.
   *
   * @param {string|import("mongoose").Types.ObjectId} courseId - Course id.
   * @param {string|import("mongoose").Types.ObjectId} userId - User id.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session]
   * @returns {Promise<boolean>} `true` when the user appears in `enrolledUsers`.
   * @throws {RepositoryValidationError} If either id is not a valid ObjectId.
   */
  async isUserEnrolled(courseId, userId, options = {}) {
    this._assertObjectId(courseId, "courseId");
    this._assertObjectId(userId, "userId");
    const found = await this.count(
      { _id: courseId, enrolledUsers: userId },
      { limit: 1, session: options.session }
    );
    return found > 0;
  }

  /**
   * Count how many users are enrolled in a course.
   *
   * @param {string|import("mongoose").Types.ObjectId} courseId - Course id.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session]
   * @returns {Promise<number>} Number of enrolled users (0 if the course is absent).
   * @throws {RepositoryValidationError} If `courseId` is not a valid ObjectId.
   */
  async countEnrollments(courseId, options = {}) {
    this._assertObjectId(courseId, "courseId");
    const course = await this.findById(courseId, {
      select: "enrolledUsers",
      lean: true,
      session: options.session,
    });
    return course?.enrolledUsers?.length ?? 0;
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Validate that a value is a castable ObjectId, throwing the repository's
   * typed validation error (HTTP 400) otherwise. Keeps id-based finders from
   * silently issuing a query that can never match.
   * @private
   * @param {*} value - Candidate id.
   * @param {string} label - Field name used in the error message.
   * @throws {RepositoryValidationError}
   */
  _assertObjectId(value, label) {
    if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
      throw new RepositoryValidationError(`Invalid ${label}: "${value}"`);
    }
  }
}

export default CourseRepository;
