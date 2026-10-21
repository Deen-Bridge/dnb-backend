/**
 * @module mongo/utils/textSearch
 * Reusable full-text search utilities for MongoDB via Mongoose.
 * -------------------------------------------------------------------------
 * These are pure, dependency-free helpers that a repository (for example
 * `BookRepository`) can compose to perform `$text` searches against a
 * Mongoose model without duplicating query-building logic.
 *
 * Why a separate utility?
 * -----------------------
 *   - **Consistency.** Every text search in the application goes through the
 *     same query construction, projection, sort and pagination logic.
 *   - **Score-based ranking.** Results are always ordered by MongoDB's
 *     computed `$meta: "textScore"`, not natural/insertion order.
 *   - **Composability.** Additional filter criteria can be combined with
 *     text search, and offset-based pagination works correctly alongside
 *     score-based sorting.
 *
 * Conventions for anything added under `/mongo`:
 *   - Repositories never call `res`/express — they return data or throw.
 *   - Every exported function/class carries complete JSDoc.
 */

/**
 * @typedef {Object} TextSearchOptions
 * @property {string} term                          The search string passed to
 *   MongoDB's `$text.$search`.
 * @property {Object} [filters={}]                  Additional filter criteria
 *   (e.g. `{ price: { $gte: 10 }, category: "Programming" }`) combined with
 *   the `$text` query via `$and`.
 * @property {Object} [projection={}]               Extra fields to project
 *   alongside the text score. The `score` field is added automatically.
 * @property {Object} [sort]                        Custom sort specification.
 *   Defaults to `{ score: { $meta: "textScore" } }`.
 * @property {number} [page=1]                      1-based page number.
 * @property {number} [limit=10]                    Documents per page (capped
 *   at 100).
 * @property {boolean} [lean=true]                  Return plain objects instead
 *   of hydrated Mongoose documents.
 * @property {Object} [mongooseOptions={}]          Additional options forwarded
 *   to the Mongoose query (e.g. `{ populate: "author" }`).
 */

/**
 * @typedef {Object} TextSearchResult
 * @property {Object[]} documents                  The page of matching documents,
 *   each carrying a `score` field with the text-match relevance score.
 * @property {number} total                         Total number of documents
 *   matching the combined query (text + filters).
 * @property {number} page                          The current 1-based page number.
 * @property {number} limit                         The page size used.
 * @property {number} pages                         Total number of pages.
 */

/**
 * Build a MongoDB `$text` search query combined with optional filter criteria.
 *
 * The returned filter object is safe to pass to `Model.find(filter, projection)`.
 * When `term` is non-empty, a `$text: { $search: term }` clause is included;
 * when `filters` is non-empty, it is intersected with the text query via `$and`.
 *
 * @param {string} term                 The search string.
 * @param {Object} [filters={}]        Additional filter criteria.
 * @returns {Object} A MongoDB filter object.
 */
export function buildTextFilter(term, filters = {}) {
  const textClause = term && String(term).trim()
    ? { $text: { $search: String(term).trim() } }
    : {};

  const filterKeys = Object.keys(filters).filter(
    (k) => filters[k] !== undefined && filters[k] !== null && filters[k] !== ""
  );

  if (filterKeys.length === 0) {
    return textClause;
  }

  const filterPart = {};
  for (const key of filterKeys) {
    filterPart[key] = filters[key];
  }

  if (Object.keys(textClause).length === 0) {
    return filterPart;
  }

  return { $and: [textClause, filterPart] };
}

/**
 * Build the projection object that includes the text-score meta field.
 *
 * When a `$text` search is active, MongoDB requires the projection to include
 * `{ score: { $meta: "textScore" } }` for the score to be accessible on the
 * returned documents. This helper merges the caller's custom projection with
 * the score field.
 *
 * @param {Object} [extraProjection={}]  Additional fields to include
 *   (e.g. `{ title: 1, description: 1 }`).
 * @returns {Object} A Mongoose projection object.
 */
export function buildTextProjection(extraProjection = {}) {
  return { ...extraProjection, score: { $meta: "textScore" } };
}

/**
 * Build the sort specification for a text search.
 *
 * Defaults to relevance-based sorting via `{ score: { $meta: "textScore" } }`.
 * Callers may override this (e.g. to sort by `{ price: 1 }`) but should be
 * aware that non-score sorts will not reflect text relevance.
 *
 * @param {Object} [customSort]  Caller-supplied sort. When `null` or
 *   `undefined` the default relevance sort is used.
 * @returns {Object} A Mongoose sort specification.
 */
export function buildTextSort(customSort) {
  if (customSort && typeof customSort === "object" && Object.keys(customSort).length > 0) {
    return customSort;
  }
  return { score: { $meta: "textScore" } };
}

/**
 * Execute a full-text search against a Mongoose model and return a page of
 * results with score-based ranking.
 *
 * This is the primary entry-point for callers that want a single-function
 * text-search-and-paginate workflow. For finer control, use the individual
 * `buildTextFilter`, `buildTextProjection`, and `buildTextSort` helpers.
 *
 * @param {Object} params
 * @param {import("mongoose").Model} params.model    The Mongoose model to
 *   search against (must have a text index defined).
 * @param {string} params.term                       The search string.
 * @param {Object} [params.filters={}]               Additional filter criteria.
 * @param {Object} [params.projection={}]            Extra fields to project.
 * @param {Object} [params.sort]                     Custom sort specification.
 * @param {number} [params.page=1]                   1-based page number.
 * @param {number} [params.limit=10]                 Documents per page.
 * @param {boolean} [params.lean=true]               Return plain objects.
 * @returns {Promise<TextSearchResult>} The search results with pagination
 *   metadata.
 * @throws {TypeError} If `model` is not provided or `term` is missing.
 */
export async function textSearch({
  model,
  term,
  filters = {},
  projection = {},
  sort,
  page = 1,
  limit = 10,
  lean = true,
} = {}) {
  if (!model) {
    throw new TypeError("textSearch: model is required");
  }
  if (!term || !String(term).trim()) {
    throw new TypeError("textSearch: term is required");
  }

  const validPage = Math.max(1, Number(page) || 1);
  const validLimit = Math.min(100, Math.max(1, Number(limit) || 10));
  const skip = (validPage - 1) * validLimit;

  const filter = buildTextFilter(term, filters);
  const textProjection = buildTextProjection(projection);
  const sortSpec = buildTextSort(sort);

  const query = model.find(filter, textProjection).sort(sortSpec).skip(skip).limit(validLimit);
  if (lean) query.lean();

  const [documents, total] = await Promise.all([
    query.exec(),
    model.countDocuments(filter).exec(),
  ]);

  return {
    documents,
    total,
    page: validPage,
    limit: validLimit,
    pages: Math.ceil(total / validLimit),
  };
}

/**
 * Default export mirrors the named exports for callers that prefer a namespace
 * import: `import textSearch from "../utils/textSearch.js"`.
 */
export default {
  buildTextFilter,
  buildTextProjection,
  buildTextSort,
  textSearch,
};
