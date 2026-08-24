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
 * └── base/               ← shared repository base classes
 *     └── BaseRepository.js   (lands with Deen-Bridge/dnb-backend#168)
 * ```
 *
 * Intended usage once model-specific repositories start landing:
 *
 * ```js
 * import { base } from "../mongo/index.js";
 *
 * class CourseRepository extends base.BaseRepository {
 *   // thin, course-specific query helpers only
 * }
 * ```
 *
 * Conventions for anything added under `/mongo`:
 *   - Repositories never call `res`/express — they return data or throw.
 *   - Errors are typed (see `base.BaseRepository`) rather than generic.
 *   - Every exported function/class carries complete JSDoc.
 */

/**
 * Namespace for shared repository base classes.
 *
 * Currently empty pending #168, which introduces `base.BaseRepository` — the
 * abstract CRUD/pagination/error-handling superclass every model-specific
 * repository extends. Kept as a stable, frozen object so consumers can start
 * importing `base` today without a breaking change when members land.
 *
 * @type {Readonly<{}>
 */
export const base = Object.freeze({});

/**
 * Default export mirrors the named exports for callers that prefer
 * `import mongo from "../mongo/index.js"`.
 */
export default { base };
