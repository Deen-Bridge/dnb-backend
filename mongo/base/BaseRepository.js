/**
 * @module mongo/base/BaseRepository
 * @description Abstract base repository encapsulating common Mongoose CRUD
 * operations, offset- and cursor-based pagination, and standardized,
 * typed error handling. Model-specific repositories should extend this class
 * instead of talking to Mongoose models directly.
 */

import mongoose from "mongoose";
import logger from "../../src/config/logger.js";

/**
 * Default number of documents returned by pagination methods.
 * @constant {number}
 */
const DEFAULT_LIMIT = 20;

/**
 * Upper bound applied to any caller-supplied `limit` so a single request
 * can never page the entire collection into memory.
 * @constant {number}
 */
const MAX_LIMIT = 100;

/**
 * Queries slower than this many milliseconds are logged as warnings.
 * @constant {number}
 */
const SLOW_OP_THRESHOLD_MS = 250;

/* -------------------------------------------------------------------------- */
/* Error types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Base class for all errors thrown by {@link BaseRepository}. Lets callers
 * branch on a stable machine-readable `code` instead of parsing messages.
 * All repository errors are operational (expected, recoverable) unless the
 * underlying cause is unexpected infrastructure failure.
 */
export class RepositoryError extends Error {
  /**
   * @param {string} code - Stable error code (e.g. `"NOT_FOUND"`).
   * @param {string} message - Human-readable description.
   * @param {object} [options]
   * @param {number} [options.statusCode=500] - HTTP status callers should map to.
   * @param {Error} [options.cause] - Original error, preserved for debugging.
   * @param {*} [options.details] - Extra structured context (e.g. invalid fields).
   */
  constructor(code, message, { statusCode = 500, cause, details } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = true;
    if (cause) this.cause = cause;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** Thrown when a document matching an id/filter does not exist. Maps to HTTP 404. */
export class DocumentNotFoundError extends RepositoryError {
  /** @param {string} message @param {object} [options] */
  constructor(message, options) {
    super("NOT_FOUND", message, { statusCode: 404, ...options });
  }
}

/** Thrown for malformed input: empty filters, bad ids/cursors, unsupported options. Maps to HTTP 400. */
export class RepositoryValidationError extends RepositoryError {
  /** @param {string} message @param {object} [options] */
  constructor(message, options) {
    super("VALIDATION_FAILED", message, { statusCode: 400, ...options });
  }
}

/** Thrown when a write violates a unique index (Mongo duplicate key `11000`). Maps to HTTP 409. */
export class DuplicateKeyError extends RepositoryError {
  /** @param {string} message @param {object} [options] */
  constructor(message, options) {
    super("DUPLICATE_KEY", message, { statusCode: 409, ...options });
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Clamp a caller-supplied limit into `[1, MAX_LIMIT]`.
 * @param {*} value - Raw limit value (may be undefined / string).
 * @returns {{limit: number, clamped: boolean}} Resolved limit and whether it was adjusted.
 */
function resolveLimit(value) {
  let limit = parseInt(value ?? DEFAULT_LIMIT, 10);
  const clamped =
    Number.isNaN(limit) || limit < 1 || limit > MAX_LIMIT;
  if (Number.isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  return { limit, clamped };
}

/**
 * Determine whether a plain-object filter is effectively empty.
 * `$and`/`$or` operators count as non-empty.
 * @param {*} filter
 * @returns {boolean}
 */
function isEmptyFilter(filter) {
  if (!filter || typeof filter !== "object") return true;
  return Object.keys(filter).length === 0;
}

/**
 * Build a Mongoose query projection option from a `select` param.
 * Accepts `"name email"` or `{ name: 1 }`.
 * @param {string|object|undefined} select
 * @returns {object|undefined}
 */
function selectOption(select) {
  if (!select) return undefined;
  return typeof select === "string" ? { [select]: 1 } : select;
}

/* -------------------------------------------------------------------------- */
/* BaseRepository                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Abstract data-access base class for a single Mongoose model.
 *
 * Subclasses only need to pass their model to the constructor; every common
 * read/write concern (CRUD, pagination, sessions, error normalization,
 * slow-query logging) is inherited. Soft deletes are opt-in per call via
 * `{ soft: true }` and are only available for models that declare a
 * soft-delete field (`isDeleted` or `deletedAt`) in their schema — otherwise
 * `delete()` performs a hard delete.
 *
 * Every method accepts an optional `session` (mongoose.ClientSession) so
 * repositories compose cleanly inside `model.db.transaction()`.
 *
 * @example
 * // mongo/repositories/CategoryRepository.js
 * import BaseRepository from "../base/BaseRepository.js";
 * import Category from "../../src/models/Category.js";
 *
 * export class CategoryRepository extends BaseRepository {
 *   constructor() {
 *     super(Category);
 *   }
 *
 *   /** @returns {Promise<import("mongoose").Document[]>} active categories ordered for menus *\/
 *   async findActiveForMenu(options = {}) {
 *     return this.findMany(
 *       { isActive: true },
 *       { sort: { order: 1, name: 1 }, select: "name slug icon", lean: true, ...options }
 *     );
 *   }
 * }
 *
 * // usage inside a service:
 * const categoryRepo = new CategoryRepository();
 * const created = await categoryRepo.create({ name: "Zakat", slug: "zakat" });
 * const page = await categoryRepo.paginate({ isActive: true }, { page: 2, limit: 10 });
 * const feed = await categoryRepo.paginateCursor({}, { cursor: "NjZh...", limit: 25 });
 */
export default class BaseRepository {
  /**
   * @param {import("mongoose").Model} model - Compiled Mongoose model this repository operates on.
   * @throws {RepositoryValidationError} If `model` is missing or not a Mongoose model.
   */
  constructor(model) {
    if (!model || !(model.prototype instanceof mongoose.Model)) {
      throw new RepositoryValidationError(
        `${this.constructor.name}: a compiled mongoose model is required`
      );
    }

    /**
     * The wrapped Mongoose model.
     * @type {import("mongoose").Model}
     * @protected
     */
    this.model = model;

    /**
     * Scoped pino logger; every entry is tagged with the concrete class name.
     * @type {import("pino").Logger}
     * @protected
     */
    this.logger = logger.child({ repository: this.constructor.name });

    /**
     * Whether this model's schema supports soft deletes.
     * @type {"isDeleted"|"deletedAt"|null}
     * @protected
     */
    this.softDeleteField = this.model.schema.path("deletedAt")
      ? "deletedAt"
      : this.model.schema.path("isDeleted")
        ? "isDeleted"
        : null;
  }

  /* ---------------------------------------------------------------------- */
  /* Writes                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Create and persist a new document.
   *
   * @param {object} data - Attributes for the new document.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @param {boolean} [options.validateBeforeSave=true] - Run schema validators.
   * @returns {Promise<import("mongoose").Document>} The saved document.
   * @throws {DuplicateKeyError} If a unique index is violated (Mongo code 11000).
   * @throws {RepositoryValidationError} If schema validation fails.
   * @example
   * const user = await userRepo.create({ name: "Aisha", email: "a@example.com" });
   */
  async create(data, options = {}) {
    const { session, validateBeforeSave = true } = options;
    return this._run("create", async () => {
      try {
        return await this.model.create([data], {
          session,
          validateBeforeSave,
        }).then(([doc]) => doc);
      } catch (err) {
        throw this._normalizeError(err, "create");
      }
    });
  }

  /**
   * Update one document by id **or** arbitrary filter.
   *
   * Passing a bare ObjectId/string targets `_id`; passing an object is used as
   * the filter directly (an empty filter throws rather than updating blindly).
   *
   * @param {string|import("mongoose").Types.ObjectId|object} idOrFilter - Document id or filter object.
   * @param {object} data - Update payload (`$set` is applied implicitly).
   * @param {object} [options]
   * @param {boolean} [options.new=true] - Return the updated document.
   * @param {boolean} [options.runValidators=true] - Validate update payload against schema.
   * @param {string|object} [options.select] - Projection of the returned document.
   * @param {(Array|object|string)} [options.populate] - Paths to populate.
   * @param {boolean} [options.upsert=false] - Insert when no document matches.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated document, or `null` with upsert disabled and nothing matched.
   * @throws {DocumentNotFoundError} When `throwIfNotFound` semantics requested and nothing matched.
   * @throws {RepositoryValidationError} On empty filter or failed validation.
   * @throws {DuplicateKeyError} On unique-index violation.
   * @example
   * await pledgeRepo.update(pledgeId, { status: "paid" }, { session });
   */
  async update(idOrFilter, data, options = {}) {
    const {
      new: returnNew = true,
      runValidators = true,
      upsert = false,
      select,
      populate,
      session,
    } = options;

    return this._run("update", async () => {
      const filter = this._resolveFilter(idOrFilter);
      try {
        const doc = await this.model
          .findOneAndUpdate(filter, { $set: data }, { new: returnNew, runValidators, upsert, session })
          .select(selectOption(select))
          .populate(populate);
        if (!doc && !upsert) {
          this.logger.warn({ filter: this._safe(filter) }, "update matched no documents");
        }
        return doc;
      } catch (err) {
        throw this._normalizeError(err, "update");
      }
    });
  }

  /**
   * Delete one document by id **or** filter.
   *
   * Hard delete is the default. Pass `{ soft: true }` to flag the document
   * instead — supported only when the schema declares an `isDeleted` or
   * `deletedAt` path (see {@link BaseRepository#softDeleteField}). Extend
   * subclasses for richer retention rules (archival, cascades).
   *
   * @param {string|import("mongoose").Types.ObjectId|object} idOrFilter - Document id or filter object.
   * @param {object} [options]
   * @param {boolean} [options.soft=false] - Soft delete instead of removing.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{acknowledged: boolean, deletedCount: number, softDeleted: boolean}>} Outcome summary.
   * @throws {DocumentNotFoundError} When nothing matched.
   * @throws {RepositoryValidationError} On empty filter, or `soft: true` for a model without a soft-delete field.
   * @example
   * await notificationRepo.delete(notificationId);            // hard delete
   * await auditLogRepo.delete(auditId, { soft: true });       // flags isDeleted/deletedAt if present
   */
  async delete(idOrFilter, options = {}) {
    const { soft = false, session } = options;

    return this._run("delete", async () => {
      const filter = this._resolveFilter(idOrFilter);

      if (soft) {
        if (!this.softDeleteField) {
          throw new RepositoryValidationError(
            `${this.model.modelName} does not declare an isDeleted/deletedAt field; soft delete unsupported`
          );
        }
        const now = new Date();
        const patch =
          this.softDeleteField === "isDeleted"
            ? { $set: { isDeleted: true } }
            : { $set: { deletedAt: now } };
        const res = await this.model.updateOne(filter, patch, { session });
        if (res.matchedCount === 0) {
          throw new DocumentNotFoundError(`${this.model.modelName} not found`, { details: { filter: this._safe(filter) } });
        }
        return { acknowledged: res.acknowledged, deletedCount: res.modifiedCount, softDeleted: true };
      }

      const doc = await this.model.findOneAndDelete(filter, { session });
      if (!doc) {
        throw new DocumentNotFoundError(`${this.model.modelName} not found`, { details: { filter: this._safe(filter) } });
      }
      return { acknowledged: true, deletedCount: 1, softDeleted: false };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Reads                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Fetch a document by its primary key.
   *
   * @param {string|import("mongoose").Types.ObjectId|null} id - Value castable to ObjectId.
   * @param {object} [options]
   * @param {string|object} [options.select] - Projection ("name email" or { name: 1 }).
   * @param {(Array|object|string)} [options.populate] - Paths to populate.
   * @param {boolean} [options.lean=false] - Return a plain JS object instead of a hydrated document.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|object|null>} The document, or `null` when absent/malformed id.
   * @example
   * const course = await courseRepo.findById(id, { populate: "educator", lean: true });
   * if (!course) throw new APIError("Course not found", 404);
   */
  async findById(id, options = {}) {
    const { select, populate, lean = false, session } = options;

    return this._run("findById", async () => {
      if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
      return this.model
        .findById(id)
        .select(selectOption(select))
        .populate(populate)
        .lean(lean)
        .session(session ?? null);
    });
  }

  /**
   * Fetch a single document matching an arbitrary filter.
   *
   * @param {object} filter - Mongo filter; must be non-empty.
   * @param {object} [options] - Same shape as {@link BaseRepository#findById}.
   * @param {string|object} [options.select]
   * @param {(Array|object|string)} [options.populate]
   * @param {boolean} [options.lean=false]
   * @param {import("mongoose").ClientSession} [options.session]
   * @returns {Promise<import("mongoose").Document|object|null>} Matching document or `null`.
   * @throws {RepositoryValidationError} When `filter` is empty (would match an arbitrary document).
   * @example
   * const user = await userRepo.findOne({ email }, { lean: true });
   */
  async findOne(filter, options = {}) {
    const { select, populate, lean = false, session } = options;

    return this._run("findOne", async () => {
      if (isEmptyFilter(filter)) {
        throw new RepositoryValidationError("findOne requires a non-empty filter");
      }
      try {
        return await this.model
          .findOne(filter)
          .select(selectOption(select))
          .populate(populate)
          .lean(lean)
          .session(session ?? null);
      } catch (err) {
        throw this._normalizeError(err, "findOne");
      }
    });
  }

  /**
   * Fetch many documents matching a filter, with optional sorting, paging and projection.
   *
   * @param {object} [filter={}] - Mongo filter; `{}` returns all documents.
   * @param {object} [options]
   * @param {object|string} [options.sort] - e.g. `{ createdAt: -1 }`.
   * @param {number} [options.limit] - Max docs to return.
   * @param {number} [options.skip] - Docs to skip (offset paging).
   * @param {string|object} [options.select]
   * @param {(Array|object|string)} [options.populate]
   * @param {boolean} [options.lean=false]
   * @param {import("mongoose").ClientSession} [options.session]
   * @returns {Promise<Array<import("mongoose").Document|object>>} Matching documents (possibly empty).
   * @example
   * const recent = await transactionRepo.findMany({ status: "pending" }, { sort: { createdAt: -1 }, limit: 50, lean: true });
   */
  async findMany(filter = {}, options = {}) {
    const { sort, limit, skip, select, populate, lean = false, session } = options;

    return this._run("findMany", async () => {
      try {
        let query = this.model.find(filter).lean(lean).session(session ?? null);
        if (sort) query = query.sort(sort);
        if (Number.isFinite(limit)) query = query.limit(limit);
        if (Number.isFinite(skip)) query = query.skip(skip);
        if (select) query = query.select(typeof select === "string" ? select : selectOption(select));
        if (populate) query = query.populate(populate);
        return await query;
      } catch (err) {
        throw this._normalizeError(err, "findMany");
      }
    });
  }

  /**
   * Count documents matching a filter.
   *
   * @param {object} [filter={}] - Mongo filter.
   * @param {object} [options]
   * @param {number} [options.limit] - Cap the counted documents (countDocuments arg).
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<number>} Number of matching documents.
   */
  async count(filter = {}, options = {}) {
    const { limit, session } = options;
    return this._run("count", () =>
      this.model.countDocuments(filter, { limit, session })
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Pagination                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Offset-based pagination for classic numbered UIs.
   *
   * Limits are clamped to `[1, 100]`. Sorting defaults to `_id` descending
   * (stable even without a `createdAt` index). Deep offsets scan skipped
   * documents server-side — prefer {@link BaseRepository#paginateCursor}
   * for unbounded feeds.
   *
   * @param {object} [filter={}] - Mongo filter.
   * @param {object} [options]
   * @param {number} [options.page=1] - 1-based page number.
   * @param {number} [options.offset] - Explicit skip; overrides computed `page` offset when provided.
   * @param {number} [options.limit=20] - Page size (clamped to 100).
   * @param {string} [options.sortBy="_id"] - Field to sort by.
   * @param {("asc"|"desc")} [options.order="desc"] - Sort direction.
   * @param {string|object} [options.select]
   * @param {(Array|object|string)} [options.populate]
   * @param {boolean} [options.lean=false]
   * @param {import("mongoose").ClientSession} [options.session]
   * @returns {Promise<{data: Array<object>, total: number, page: number, limit: number, totalPages: number, offset: number, hasNextPage: boolean, hasPrevPage: boolean}>} Page plus metadata.
   * @throws {RepositoryValidationError} If `sortBy` resolves to an empty field name.
   * @example
   * const { data, total, hasNextPage } = await userRepo.paginate(
   *   { isActive: true },
   *   { page: req.query.page, limit: req.query.limit, sortBy: "createdAt" }
   * );
   */
  async paginate(filter = {}, options = {}) {
    const {
      page: rawPage = 1,
      offset: explicitOffset,
      sortBy = "_id",
      order = "desc",
      select,
      populate,
      lean = false,
      session,
    } = options;

    return this._run("paginate", async () => {
      const { limit, clamped } = resolveLimit(options.limit);
      let page = parseInt(rawPage, 10);
      if (Number.isNaN(page) || page < 1) page = 1;
      if (clamped || Number.isNaN(parseInt(options.limit, 10))) {
        this.logger.debug({ requestedLimit: options.limit, resolvedLimit: limit }, "pagination limit clamped");
      }

      const offset = Number.isFinite(explicitOffset) ? Math.max(0, explicitOffset) : (page - 1) * limit;
      const direction = String(order).toLowerCase() === "asc" ? 1 : -1;
      const sortField = String(sortBy).trim();
      if (!sortField) {
        throw new RepositoryValidationError("sortBy cannot be empty");
      }

      const [data, total] = await Promise.all([
        this.findMany(filter, { sort: { [sortField]: direction }, limit, skip: offset, select, populate, lean, session }),
        this.count(filter, { session }),
      ]);

      const totalPages = Math.ceil(total / limit);
      return {
        data,
        total,
        page,
        limit,
        totalPages,
        offset,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      };
    });
  }

  /**
   * Cursor-based pagination keyed on a unique `_id` boundary — stable under
   * concurrent inserts/deletes, O(limit) cost at any depth. Requires reading
   * rows in `_id` order (ascending or descending), which matches how
   * ObjectIds encode creation time.
   *
   * @param {object} [filter={}] - Mongo filter combined internally with the cursor condition.
   * @param {object} [options]
   * @param {string} [options.cursor] - Opaque cursor from a previous response's `nextCursor` (`null`/omitted starts from the beginning).
   * @param {number} [options.limit=20] - Page size (clamped to 100).
   * @param {("asc"|"desc")} [options.order="desc"] - Direction of `_id` traversal ("newest-first" by default).
   * @param {string|object} [options.select]
   * @param {(Array|object|string)} [options.populate]
   * @param {boolean} [options.lean=false]
   * @param {import("mongoose").ClientSession} [options.session]
   * @returns {Promise<{data: Array<object>, nextCursor: string|null, hasMore: boolean, limit: number}>} Page plus continuation token.
   * @throws {RepositoryValidationError} If `cursor` is not a valid encoded ObjectId.
   * @example
   * // GET /api/v1/feed?cursor=NjZhMm...&limit=25
   * const page = await reelRepo.paginateCursor({ spaceId }, { cursor: req.query.cursor, limit: 25 });
   * res.json({ items: page.data, nextCursor: page.nextCursor });
   */
  async paginateCursor(filter = {}, options = {}) {
    const {
      cursor,
      order = "desc",
      select,
      populate,
      lean = false,
      session,
    } = options;

    return this._run("paginateCursor", async () => {
      const { limit, clamped } = resolveLimit(options.limit);
      if (clamped) {
        this.logger.debug({ requestedLimit: options.limit, resolvedLimit: limit }, "cursor pagination limit clamped");
      }
      const direction = String(order).toLowerCase() === "asc" ? 1 : -1;

      const effectiveFilter = { ...filter };
      if (cursor != null && cursor !== "") {
        const boundary = this._decodeCursor(cursor);
        effectiveFilter._id = { ...(filter._id ?? {}), [direction === 1 ? "$gt" : "$lt"]: boundary };
      }

      const data = await this.findMany(effectiveFilter, {
        sort: { _id: direction },
        limit: limit + 1, // fetch one extra to detect hasMore without a second query
        select,
        populate,
        lean,
        session,
      });

      const hasMore = data.length > limit;
      if (hasMore) data.length = limit;
      const last = data.at(-1);

      return {
        data,
        nextCursor: hasMore && last ? this._encodeCursor(last._id) : null,
        hasMore,
        limit,
      };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Normalize an id-or-filter argument into a Mongo filter, validating ids.
   * @protected
   * @param {string|import("mongoose").Types.ObjectId|object} idOrFilter
   * @returns {object} Mongo filter.
   * @throws {RepositoryValidationError} For empty filters or non-castable ids.
   */
  _resolveFilter(idOrFilter) {
    if (idOrFilter instanceof mongoose.Types.ObjectId || typeof idOrFilter === "string") {
      if (!mongoose.Types.ObjectId.isValid(idOrFilter)) {
        throw new RepositoryValidationError(`Invalid ObjectId: "${idOrFilter}"`);
      }
      return { _id: new mongoose.Types.ObjectId(idOrFilter) };
    }
    if (isEmptyFilter(idOrFilter)) {
      throw new RepositoryValidationError(
        "Refusing to target every document: provide an id or a non-empty filter"
      );
    }
    return idOrFilter;
  }

  /**
   * Map driver/schema errors to typed repository errors; unknown errors pass
   * through untouched so original stack traces survive. Also logs.
   * @protected
   * @param {Error} err - Error raised by Mongoose/MongoDB.
   * @param {string} op - Operation name for log context.
   * @returns {RepositoryError|Error} Normalized error ready to be thrown.
   */
  _normalizeError(err, op) {
    if (err instanceof RepositoryError) return err;

    // Mongo duplicate key (unique index violation)
    if (err?.code === 11000) {
      this.logger.warn({ op, keyValue: err.keyValue }, "duplicate key");
      return new DuplicateKeyError(
        `Duplicate value for ${Object.keys(err.keyValue ?? {}).join(", ") || "unique field"}`,
        { cause: err, details: err.keyValue }
      );
    }

    // Bad ObjectId / bad value type for a path
    if (err?.name === "CastError") {
      this.logger.warn({ op, path: err.path, value: err.value }, "cast error");
      return new RepositoryValidationError(`Invalid value for ${err.path}: ${err.value}`, { cause: err });
    }

    // Schema validation failure
    if (err?.name === "ValidationError") {
      const details = Object.fromEntries(
        Object.values(err.errors ?? {}).map((e) => [e.path, e.message])
      );
      this.logger.warn({ op, details }, "validation failed");
      return new RepositoryValidationError("Document validation failed", { cause: err, details });
    }

    // Unknown: log and rethrow original so nothing is swallowed silently.
    this.logger.error({ err, op }, "unexpected repository error");
    return err;
  }

  /**
   * Time an operation, emit debug logs on success, warn above the slow-op
   * threshold, then return/propagate the result. Errors are re-thrown —
   * never swallowed.
   * @protected
   * @template T
   * @param {string} op - Operation name for logs.
   * @param {() => Promise<T>} fn - Operation body.
   * @returns {Promise<T>}
   */
  async _run(op, fn) {
    const startedAt = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - startedAt;
      if (durationMs >= SLOW_OP_THRESHOLD_MS) {
        this.logger.warn({ op, durationMs }, "slow repository operation");
      } else {
        this.logger.debug({ op, durationMs }, "repository operation complete");
      }
      return result;
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err : new Error(String(err)), op, durationMs: Date.now() - startedAt },
        "repository operation failed"
      );
      throw err;
    }
  }

  /**
   * Encode a raw `_id` as an opaque base64url cursor.
   * @protected
   * @param {import("mongoose").Types.ObjectId|string} id
   * @returns {string} URL-safe cursor token.
   */
  _encodeCursor(id) {
    return Buffer.from(String(id), "utf8").toString("base64url");
  }

  /**
   * Decode an opaque cursor back into an ObjectId boundary.
   * @protected
   * @param {string} cursor
   * @returns {import("mongoose").Types.ObjectId}
   * @throws {RepositoryValidationError} If decoding or casting fails.
   */
  _decodeCursor(cursor) {
    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      if (!mongoose.Types.ObjectId.isValid(decoded)) throw new Error("not an ObjectId");
      return new mongoose.Types.ObjectId(decoded);
    } catch {
      throw new RepositoryValidationError("Malformed pagination cursor");
    }
  }

  /**
   * Redact a filter for logging (drop operator objects which may embed PII).
   * @protected
   * @param {object} filter
   * @returns {object} Log-safe shallow summary of the filter keys.
   */
  _safe(filter) {
    if (!filter || typeof filter !== "object") return {};
    return Object.fromEntries(
      Object.entries(filter).map(([k, v]) => [
        k,
        v && typeof v === "object" ? "[complex]" : "[value]",
      ])
    );
  }
}
