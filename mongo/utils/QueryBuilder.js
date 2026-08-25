/**
 * @module mongo/utils/QueryBuilder
 * Fluent query builder utility for Mongoose queries (#180).
 * -------------------------------------------------------------------------
 * `QueryBuilder` provides a chainable, fluent interface for constructing
 * complex MongoDB queries. It reduces boilerplate and improves code
 * readability when building queries with multiple conditions, projections,
 * sorting, pagination, and population.
 *
 * The builder wraps a Mongoose Query object and exposes chainable methods
 * that mirror common query operations. Call `exec()` or `lean().exec()` to
 * execute the query and retrieve results.
 *
 * Conventions:
 *   - Repositories never touch `res`/express - they return data or throw.
 *   - Every exported method carries complete JSDoc.
 *   - The builder is immutable-ish: each method returns `this` for chaining,
 *     but mutates the underlying query.
 *
 * @example
 * import QueryBuilder from "../mongo/utils/QueryBuilder.js";
 * import User from "../models/User.js";
 *
 * const users = await new QueryBuilder(User)
 *   .where({ status: "active", role: "educator" })
 *   .select("name email createdAt")
 *   .sort({ createdAt: -1 })
 *   .limit(20)
 *   .skip(40)
 *   .populate("courses")
 *   .lean()
 *   .exec();
 */

/**
 * @typedef {Object} WhereCondition
 * @description A MongoDB filter object or a key-value pair for equality matching.
 */

/**
 * Fluent query builder for Mongoose models.
 *
 * Wraps a Mongoose model or query and provides chainable methods for
 * constructing complex queries in a readable, declarative style.
 */
export class QueryBuilder {
  /**
   * Create a new QueryBuilder instance.
   *
   * @param {import("mongoose").Model|import("mongoose").Query} modelOrQuery
   *   Either a Mongoose Model (starts a new `find()` query) or an existing
   *   Query object to wrap and extend.
   * @throws {TypeError} If `modelOrQuery` is not a valid Model or Query.
   */
  constructor(modelOrQuery) {
    if (!modelOrQuery) {
      throw new TypeError("QueryBuilder: a Model or Query is required");
    }

    // If it's a Model, start with a find() query
    if (typeof modelOrQuery.find === "function" && typeof modelOrQuery.schema !== "undefined") {
      /** @type {import("mongoose").Query} */
      this._query = modelOrQuery.find();
      /** @type {import("mongoose").Model} */
      this._model = modelOrQuery;
    } else if (typeof modelOrQuery.exec === "function") {
      // It's already a Query
      this._query = modelOrQuery;
      this._model = modelOrQuery.model;
    } else {
      throw new TypeError("QueryBuilder: expected a Mongoose Model or Query");
    }

    /** @type {boolean} */
    this._isLean = false;
  }

  /**
   * Add filter conditions to the query.
   *
   * Accepts either a MongoDB filter object or a field name and value for
   * simple equality matching. Multiple calls are merged (AND'd together).
   *
   * @param {string|Object} fieldOrConditions Field name or filter object.
   * @param {*} [value] Value for equality match when first arg is a string.
   * @returns {this} The builder instance for chaining.
   *
   * @example
   * builder.where({ status: "active" });
   * builder.where("role", "educator");
   * builder.where({ age: { $gte: 18 } });
   */
  where(fieldOrConditions, value) {
    if (typeof fieldOrConditions === "string") {
      this._query.where(fieldOrConditions).equals(value);
    } else if (fieldOrConditions && typeof fieldOrConditions === "object") {
      this._query.where(fieldOrConditions);
    }
    return this;
  }

  /**
   * Add an equality condition.
   *
   * @param {string} field Field name to match.
   * @param {*} value Value to match against.
   * @returns {this} The builder instance for chaining.
   */
  equals(field, value) {
    this._query.where(field).equals(value);
    return this;
  }

  /**
   * Add a greater-than condition.
   *
   * @param {string} field Field name.
   * @param {*} value Threshold value.
   * @returns {this} The builder instance for chaining.
   */
  gt(field, value) {
    this._query.where(field).gt(value);
    return this;
  }

  /**
   * Add a greater-than-or-equal condition.
   *
   * @param {string} field Field name.
   * @param {*} value Threshold value.
   * @returns {this} The builder instance for chaining.
   */
  gte(field, value) {
    this._query.where(field).gte(value);
    return this;
  }

  /**
   * Add a less-than condition.
   *
   * @param {string} field Field name.
   * @param {*} value Threshold value.
   * @returns {this} The builder instance for chaining.
   */
  lt(field, value) {
    this._query.where(field).lt(value);
    return this;
  }

  /**
   * Add a less-than-or-equal condition.
   *
   * @param {string} field Field name.
   * @param {*} value Threshold value.
   * @returns {this} The builder instance for chaining.
   */
  lte(field, value) {
    this._query.where(field).lte(value);
    return this;
  }

  /**
   * Add an $in condition (value in array).
   *
   * @param {string} field Field name.
   * @param {Array} values Array of possible values.
   * @returns {this} The builder instance for chaining.
   */
  in(field, values) {
    this._query.where(field).in(values);
    return this;
  }

  /**
   * Add a $nin condition (value not in array).
   *
   * @param {string} field Field name.
   * @param {Array} values Array of excluded values.
   * @returns {this} The builder instance for chaining.
   */
  nin(field, values) {
    this._query.where(field).nin(values);
    return this;
  }

  /**
   * Add a regex match condition.
   *
   * @param {string} field Field name.
   * @param {RegExp|string} pattern Regex pattern or string.
   * @param {string} [flags] Regex flags (when pattern is a string).
   * @returns {this} The builder instance for chaining.
   */
  regex(field, pattern, flags) {
    const rx = pattern instanceof RegExp ? pattern : new RegExp(pattern, flags);
    this._query.where(field).regex(rx);
    return this;
  }

  /**
   * Add an exists condition.
   *
   * @param {string} field Field name.
   * @param {boolean} [exists=true] Whether the field should exist.
   * @returns {this} The builder instance for chaining.
   */
  exists(field, exists = true) {
    this._query.where(field).exists(exists);
    return this;
  }

  /**
   * Set field projection (select which fields to include/exclude).
   *
   * @param {string|string[]|Object} fields Field specification.
   *   - String: space-separated field names (prefix with `-` to exclude).
   *   - Array: field names to include.
   *   - Object: `{ field: 1 }` for include, `{ field: 0 }` for exclude.
   * @returns {this} The builder instance for chaining.
   *
   * @example
   * builder.select("name email -password");
   * builder.select(["name", "email"]);
   * builder.select({ name: 1, email: 1 });
   */
  select(fields) {
    this._query.select(fields);
    return this;
  }

  /**
   * Set sort order.
   *
   * @param {string|Object} spec Sort specification.
   *   - String: space-separated fields (prefix with `-` for descending).
   *   - Object: `{ field: 1 }` for ascending, `{ field: -1 }` for descending.
   * @returns {this} The builder instance for chaining.
   *
   * @example
   * builder.sort("-createdAt name");
   * builder.sort({ createdAt: -1, name: 1 });
   */
  sort(spec) {
    this._query.sort(spec);
    return this;
  }

  /**
   * Limit the number of results.
   *
   * @param {number} count Maximum number of documents to return.
   * @returns {this} The builder instance for chaining.
   */
  limit(count) {
    if (typeof count === "number" && count >= 0) {
      this._query.limit(count);
    }
    return this;
  }

  /**
   * Skip a number of documents (offset pagination).
   *
   * @param {number} count Number of documents to skip.
   * @returns {this} The builder instance for chaining.
   */
  skip(count) {
    if (typeof count === "number" && count >= 0) {
      this._query.skip(count);
    }
    return this;
  }

  /**
   * Apply page-based pagination.
   *
   * Convenience method that computes `skip` from a 1-based page number.
   *
   * @param {number} page 1-based page number.
   * @param {number} perPage Number of documents per page.
   * @returns {this} The builder instance for chaining.
   *
   * @example
   * builder.paginate(3, 20); // Page 3, 20 items per page
   */
  paginate(page, perPage) {
    const pageNum = Math.max(1, Math.floor(page) || 1);
    const limit = Math.max(1, Math.floor(perPage) || 20);
    this._query.skip((pageNum - 1) * limit).limit(limit);
    return this;
  }

  /**
   * Populate referenced documents.
   *
   * @param {string|Object|Array<string|Object>} paths Path(s) to populate.
   * @returns {this} The builder instance for chaining.
   *
   * @example
   * builder.populate("author");
   * builder.populate({ path: "author", select: "name email" });
   * builder.populate(["author", "category"]);
   */
  populate(paths) {
    if (!paths) return this;

    const pathList = Array.isArray(paths) ? paths : [paths];
    for (const path of pathList) {
      this._query.populate(path);
    }
    return this;
  }

  /**
   * Return plain JavaScript objects instead of Mongoose documents.
   *
   * @param {boolean} [enabled=true] Whether to enable lean mode.
   * @returns {this} The builder instance for chaining.
   */
  lean(enabled = true) {
    this._isLean = enabled;
    this._query.lean(enabled);
    return this;
  }

  /**
   * Execute the query and return results.
   *
   * @returns {Promise<Object[]>} The query results.
   */
  async exec() {
    return this._query.exec();
  }

  /**
   * Execute and return a single document.
   *
   * Modifies the underlying query to `findOne()`.
   *
   * @returns {Promise<Object|null>} The first matching document or null.
   */
  async one() {
    // Clone the conditions and apply to a findOne query
    const conditions = this._query.getFilter();
    const options = this._query.getOptions();

    let query = this._model.findOne(conditions);

    if (options.sort) query = query.sort(options.sort);
    if (options.projection) query = query.select(options.projection);
    if (this._isLean) query = query.lean();

    // Apply populations
    const populatedPaths = this._query.getPopulatedPaths();
    for (const path of populatedPaths || []) {
      query = query.populate(path);
    }

    return query.exec();
  }

  /**
   * Count documents matching the current filter.
   *
   * @returns {Promise<number>} The count of matching documents.
   */
  async count() {
    const conditions = this._query.getFilter();
    return this._model.countDocuments(conditions).exec();
  }

  /**
   * Check if any documents match the current filter.
   *
   * @returns {Promise<boolean>} True if at least one document matches.
   */
  async exists() {
    const conditions = this._query.getFilter();
    const doc = await this._model.findOne(conditions).select("_id").lean().exec();
    return doc !== null;
  }

  /**
   * Get distinct values for a field.
   *
   * @param {string} field Field name.
   * @returns {Promise<Array>} Array of distinct values.
   */
  async distinct(field) {
    const conditions = this._query.getFilter();
    return this._model.distinct(field, conditions).exec();
  }

  /**
   * Get the underlying Mongoose Query object.
   *
   * Useful for advanced operations not covered by the builder.
   *
   * @returns {import("mongoose").Query} The wrapped query.
   */
  getQuery() {
    return this._query;
  }

  /**
   * Clone the builder for branching queries.
   *
   * @returns {QueryBuilder} A new builder with the same state.
   */
  clone() {
    const cloned = new QueryBuilder(this._query.clone());
    cloned._isLean = this._isLean;
    return cloned;
  }
}

/**
 * Factory function to create a QueryBuilder from a model.
 *
 * @param {import("mongoose").Model} model The Mongoose model.
 * @returns {QueryBuilder} A new QueryBuilder instance.
 *
 * @example
 * import { query } from "../mongo/utils/QueryBuilder.js";
 * import User from "../models/User.js";
 *
 * const users = await query(User)
 *   .where({ status: "active" })
 *   .sort("-createdAt")
 *   .limit(10)
 *   .exec();
 */
export function query(model) {
  return new QueryBuilder(model);
}

export default QueryBuilder;
