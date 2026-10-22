/**
 * @module mongo
 * Entry point for the MongoDB data-access layer.
 * -------------------------------------------------------------------------
 * This module is the public surface of the `/mongo` repository layer — the
 * home of data-access code that is being separated from route handlers and
 * services so persistence logic stays consistent and testable.
 *
 * Structure
 * ---------
 * ```
 * mongo/
 * ├── index.js            ← you are here: re-exports everything below
 * ├── base/               ← shared repository base classes
 * │   └── BaseRepository.js
 * └── repositories/       ← model-specific repositories
 *     ├── BookRepository.js
 *     ├── NotificationRepository.js
 *     └── ReelRepository.js
 *     └── NotificationRepository.js
 *     └── EducatorBalanceRepository.js
 * ```
 *
 * Intended usage:
 *
 * ```js
 * import { base } from "../mongo/index.js";
 * import Reel from "../../src/models/Reel.js";
 *
 * class CourseRepository extends base.BaseRepository {
 *   constructor() {
 *     super(Reel);
 * import BaseRepository from "../mongo/base/BaseRepository.js";
 *
 * class CourseRepository extends BaseRepository {
 *   constructor() {
 *     super(Course);
 *   }
 *   // thin, course-specific query helpers only
 * }
 * ```
 *
 * Conventions for anything added under `/mongo`:
 *   - Repositories never call `res`/express — they return data or throw.
 *   - Errors are typed (see `base.BaseRepository`) rather than generic.
 *   - Every exported function/class carries complete JSDoc.
 */

import BaseRepository from "./base/BaseRepository.js";

/**
 * Namespace for shared repository base classes.
 *
 * @type {{ BaseRepository: typeof BaseRepository }}
 */
export const base = Object.freeze({ BaseRepository });

/**
 * Model-specific repositories.
 */
export { default as BookRepository } from "./repositories/BookRepository.js";
export { default as NotificationRepository } from "./repositories/NotificationRepository.js";
export { default as ReelRepository } from "./repositories/ReelRepository.js";
export { default as EducatorBalanceRepository } from "./repositories/EducatorBalanceRepository.js";

/**
 * Default export mirrors the named exports for callers that prefer
 * `import mongo from "../mongo/index.js"`.
 */
export default { base };
