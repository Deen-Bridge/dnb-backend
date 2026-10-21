/**
 * @module mongo/mixins/Searchable
 * Mixin that adds a consistent full-text search interface to Mongoose models.
 * -------------------------------------------------------------------------
 * This mixin can be applied to any Mongoose schema that has a text index
 * defined. It provides a `.search()` static method (or instance method on
 * the model) that delegates to the {@link module:mongo/utils/textSearch}
 * utility, giving every model the same search interface without duplicating
 * query-building logic.
 *
 * Usage
 * -----
 * ```js
 * import { applySearchable } from "../mixins/Searchable.js";
 *
 * const bookSchema = new mongoose.Schema({ ... });
 * bookSchema.index({ title: "text", description: "text" });
 * applySearchable(bookSchema);
 *
 * const Book = mongoose.model("Book", bookSchema);
 * const results = await Book.search({ term: "react", page: 1, limit: 10 });
 * ```
 *
 * Conventions for anything added under `/mongo`:
 *   - Repositories never call `res`/express — they return data or throw.
 *   - Every exported function/class carries complete JSDoc.
 */

import { textSearch, buildTextFilter, buildTextProjection, buildTextSort } from "../utils/textSearch.js";

/**
 * @typedef {import("../utils/textSearch.js").TextSearchOptions} SearchOptions
 */

/**
 * @typedef {import("../utils/textSearch.js").TextSearchResult} SearchResult
 */

/**
 * Apply the Searchable mixin to a Mongoose schema.
 *
 * After calling this function, the schema's model will have a `.search()`
 * static method and a `._buildSearchQuery()` helper method available.
 *
 * @param {import("mongoose").Schema} schema  The Mongoose schema to enhance.
 * @param {Object} [config={}]                Optional configuration.
 * @param {string[]} [config.defaultFields]   Fields to project by default
 *   when no explicit projection is provided. If omitted, all fields are
 *   returned (no projection applied).
 * @param {Object} [config.defaultFilters]    Default filters always applied
 *   (e.g. `{ isActive: true }`). Merged with caller-supplied filters.
 * @returns {void}
 * @throws {TypeError} If `schema` is not a Mongoose schema instance.
 */
export function applySearchable(schema, config = {}) {
  if (!schema || typeof schema.static !== "function") {
    throw new TypeError("applySearchable: schema must be a Mongoose Schema instance");
  }

  const { defaultFields, defaultFilters } = config;

  /**
   * Execute a full-text search against this model.
   *
   * This is the primary search interface for any model that has the
   * Searchable mixin applied. It delegates to the shared
   * {@link module:mongo/utils/textSearch.textSearch} utility.
   *
   * @param {SearchOptions & { term: string }} options  Search parameters.
   * @returns {Promise<SearchResult>} The search results.
   * @example
   * const { documents, total, page, pages } = await Book.search({
   *   term: "react patterns",
   *   filters: { price: { $gte: 0 } },
   *   page: 1,
   *   limit: 10,
   * });
   */
  schema.static("search", async function searchable(options = {}) {
    const { filters: callerFilters, projection, ...rest } = options;

    // Merge default filters with caller-supplied filters
    const mergedFilters = { ...defaultFilters, ...callerFilters };

    // Use default fields if no explicit projection is provided
    const effectiveProjection =
      projection !== undefined ? projection : defaultFields ? Object.fromEntries(defaultFields.map((f) => [f, 1])) : {};

    return textSearch({
      model: this,
      filters: mergedFilters,
      projection: effectiveProjection,
      ...rest,
    });
  });

  /**
   * Build a text-search filter without executing the query.
   *
   * Useful for composing search filters into larger queries or for testing.
   *
   * @param {string} term       The search string.
   * @param {Object} [filters]  Additional filter criteria.
   * @returns {Object} A MongoDB filter object.
   */
  schema.static("_buildSearchFilter", function _buildSearchFilter(term, filters = {}) {
    const merged = { ...defaultFilters, ...filters };
    return buildTextFilter(term, merged);
  });

  /**
   * Build a text-search projection without executing the query.
   *
   * @param {Object} [extraProjection]  Additional fields to include.
   * @returns {Object} A Mongoose projection object.
   */
  schema.static("_buildSearchProjection", function _buildSearchProjection(extraProjection = {}) {
    return buildTextProjection(
      defaultFields
        ? { ...Object.fromEntries(defaultFields.map((f) => [f, 1])), ...extraProjection }
        : extraProjection
    );
  });

  /**
   * Build a text-search sort specification without executing the query.
   *
   * @param {Object} [customSort]  Caller-supplied sort override.
   * @returns {Object} A Mongoose sort specification.
   */
  schema.static("_buildSearchSort", function _buildSearchSort(customSort) {
    return buildTextSort(customSort);
  });
}

/**
 * Default export mirrors the named export for callers that prefer a namespace
 * import: `import searchable from "../mixins/Searchable.js"`.
 */
export default { applySearchable };
