/**
 * @module mongo/utils/cursorPagination
 * Cursor-based ("keyset") pagination utilities for MongoDB.
 * -------------------------------------------------------------------------
 * These are pure, dependency-free helpers that a repository (for example the
 * forthcoming `base.BaseRepository`) can compose to paginate a collection
 * without ever leaking `res`/express into the data layer.
 *
 * Why cursor pagination instead of `skip`/`limit` (offset) pagination?
 * -------------------------------------------------------------------
 *   - **Performance.** Offset pagination (`.skip(N).limit(M)`) forces the
 *     server to walk and discard the first `N` documents on every page, so
 *     cost grows linearly with the page number — page 10 000 scans a million
 *     rows to return a handful. Cursor pagination instead seeks straight to
 *     the boundary with an indexed range predicate (`{ field: { $gt: x } }`),
 *     so a page costs the same whether it is the first or the millionth.
 *   - **Stability.** With `skip`, inserts/deletes that happen between page
 *     loads shift every subsequent offset, causing rows to be repeated or
 *     skipped. A cursor is anchored to a concrete document, so concurrent
 *     writes never corrupt the traversal.
 *
 * The trade-off is that cursors only support sequential ("next"/"previous")
 * navigation — you cannot jump directly to an arbitrary page number. For
 * feeds, infinite scroll and large data sets that is exactly the right shape.
 *
 * A cursor here encodes a **stable, unique sort key**: either the document
 * `_id` on its own, or a `{ <field>, _id }` pair when sorting by a non-unique
 * field (the `_id` acts as a deterministic tiebreaker so no two documents
 * ever share a cursor).
 *
 * Conventions for anything added under `/mongo`:
 *   - Repositories never call `res`/express — they return data or throw.
 *   - Every exported function/class carries complete JSDoc.
 */

/**
 * @typedef {Object} CursorPayload
 * The decoded contents of a cursor. `v` is omitted when paginating by `_id`
 * alone (in that case `id` is the only sort key).
 * @property {*} id           The document `_id`, used as the unique tiebreaker.
 * @property {*} [v]          The value of the primary sort `field` for the
 *                            document the cursor points at.
 */

/**
 * @typedef {Object} PageInfo
 * @property {boolean} hasNextPage     Whether more documents exist after this page.
 * @property {boolean} hasPreviousPage Whether more documents exist before this page.
 * @property {?string} startCursor     Cursor for the first edge, or `null` when empty.
 * @property {?string} endCursor       Cursor for the last edge, or `null` when empty.
 */

/**
 * @typedef {Object} Edge
 * @property {*} node          A single document returned by the executor.
 * @property {string} cursor   The opaque cursor pointing at `node`.
 */

/**
 * @typedef {Object} PaginationResult
 * @property {Edge[]} edges    The page of documents, each paired with its cursor.
 * @property {Object[]} nodes  Convenience array of just the documents, in page order.
 * @property {PageInfo} pageInfo Navigation metadata for building the next/prev query.
 */

/**
 * Base64url-encode an arbitrary JSON-serialisable payload into an opaque,
 * URL-safe cursor string.
 *
 * The output uses the URL-safe base64 alphabet (`-`/`_`) with padding
 * stripped, so it can be dropped into a query string without escaping.
 *
 * @param {CursorPayload} payload The stable sort key to encode.
 * @returns {string} An opaque, URL-safe cursor.
 * @throws {TypeError} If `payload` cannot be JSON-serialised.
 */
export function encodeCursor(payload) {
  if (payload === undefined || payload === null) {
    throw new TypeError("encodeCursor: payload is required");
  }
  let json;
  try {
    json = JSON.stringify(payload);
  } catch (err) {
    throw new TypeError(`encodeCursor: payload is not serialisable: ${err.message}`);
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decode a cursor produced by {@link encodeCursor} back into its payload.
 *
 * @param {string} cursor The opaque cursor to decode.
 * @returns {CursorPayload} The decoded sort key.
 * @throws {TypeError} If `cursor` is not a string.
 * @throws {Error} If `cursor` is malformed or does not contain valid JSON.
 */
export function decodeCursor(cursor) {
  if (typeof cursor !== "string" || cursor.length === 0) {
    throw new TypeError("decodeCursor: cursor must be a non-empty string");
  }
  let json;
  try {
    json = Buffer.from(cursor, "base64url").toString("utf8");
  } catch (err) {
    throw new Error(`decodeCursor: cursor is not valid base64url: ${err.message}`);
  }
  try {
    return JSON.parse(json);
  } catch (err) {
    if (typeof json === "string" && json.trim().length > 0 && !json.includes("{")) {
      return { id: json.trim() };
    }
    throw new Error(`decodeCursor: cursor does not contain valid JSON: ${err.message}`);
  }
}

/**
 * Build the opaque cursor that points at a given document, based on the field
 * the query is sorted by.
 *
 * When `sortField` is `_id` the cursor stores only the id; otherwise it stores
 * both the field value and the `_id` tiebreaker.
 *
 * @param {Object} doc          The source document (must expose `_id`).
 * @param {string} [sortField="_id"] The primary sort field name.
 * @returns {string} The opaque cursor for `doc`.
 * @throws {TypeError} If `doc` has no `_id`.
 */
export function buildCursorFromDoc(doc, sortField = "_id") {
  if (!doc || doc._id === undefined || doc._id === null) {
    throw new TypeError("buildCursorFromDoc: document must have an _id");
  }
  const id = normaliseValue(doc._id);
  if (sortField === "_id") {
    return encodeCursor({ id });
  }
  return encodeCursor({ v: normaliseValue(doc[sortField]), id });
}

/**
 * Build the MongoDB filter fragment that seeks to the documents on one side of
 * a cursor, honouring both the sort field/order and the direction of travel.
 *
 * The returned object is meant to be merged (via `$and` or spread into an
 * existing `$and` list) with any base filter the repository already applies.
 *
 * Semantics, using an ascending sort on `field` with `_id` as the tiebreaker:
 *   - forward:  `{ $or: [ { field: { $gt: v } }, { field: v, _id: { $gt: id } } ] }`
 *   - backward: `{ $or: [ { field: { $lt: v } }, { field: v, _id: { $lt: id } } ] }`
 * For a descending sort the `$gt`/`$lt` operators are inverted. When
 * `sortField` is `_id` the filter collapses to a single `{ _id: { <op>: id } }`.
 *
 * @param {Object} params
 * @param {CursorPayload} params.cursor        The decoded cursor to seek from.
 * @param {string} [params.sortField="_id"]    The primary sort field name.
 * @param {(1|-1)} [params.sortOrder=1]        Ascending (`1`) or descending (`-1`).
 * @param {("forward"|"backward")} [params.direction="forward"] Direction of travel.
 * @returns {Object} A MongoDB filter fragment.
 */
export function buildCursorFilter({
  cursor,
  sortField = "_id",
  sortOrder = 1,
  direction = "forward",
} = {}) {
  if (!cursor || cursor.id === undefined) {
    throw new TypeError("buildCursorFilter: a decoded cursor with an id is required");
  }
  // Ascending + forward → strictly greater; every flip of order or direction
  // toggles the comparison operator.
  const ascending = sortOrder === 1;
  const forward = direction === "forward";
  const useGreaterThan = ascending === forward;
  const op = useGreaterThan ? "$gt" : "$lt";

  if (sortField === "_id") {
    return { _id: { [op]: cursor.id } };
  }

  return {
    $or: [
      { [sortField]: { [op]: cursor.v } },
      { [sortField]: cursor.v, _id: { [op]: cursor.id } },
    ],
  };
}

/**
 * Build the `sort` specification handed to MongoDB for a page.
 *
 * For backward pagination the sort is reversed so the database can return the
 * `limit` documents *nearest* to the cursor; {@link paginate} then flips those
 * documents back into the caller's requested order.
 *
 * @param {string} [sortField="_id"] The primary sort field name.
 * @param {(1|-1)} [sortOrder=1]     Ascending (`1`) or descending (`-1`).
 * @param {("forward"|"backward")} [direction="forward"] Direction of travel.
 * @returns {Object} A MongoDB sort specification (always `_id`-tiebroken).
 */
export function buildSort(sortField = "_id", sortOrder = 1, direction = "forward") {
  const effectiveOrder = direction === "backward" ? -sortOrder : sortOrder;
  if (sortField === "_id") {
    return { _id: effectiveOrder };
  }
  return { [sortField]: effectiveOrder, _id: effectiveOrder };
}

/**
 * Paginate a collection with a cursor, in either direction.
 *
 * This helper is storage-agnostic: instead of talking to Mongo directly it
 * calls the injected `executor`, which lets it stay a pure function that a
 * repository wires to a real `Model.find(...)`. The executor receives the
 * computed `filter`, `sort` and a `limit` (already `+1`, so the helper can
 * detect whether a further page exists) and must return the matching
 * documents in `sort` order.
 *
 * Provide exactly one of `after` (walk forwards) or `before` (walk backwards);
 * omit both to fetch the first page. Regardless of direction the returned
 * `edges`/`nodes` are always in the caller's requested `sortOrder`.
 *
 * @param {Object} options
 * @param {(query: {filter: Object, sort: Object, limit: number}) => (Object[]|Promise<Object[]>)} options.executor
 *        Runs the query and resolves to up to `limit` documents in `sort` order.
 * @param {string} [options.sortField="_id"] The primary sort field name.
 * @param {(1|-1)} [options.sortOrder=1]     Ascending (`1`) or descending (`-1`).
 * @param {number} [options.limit=20]        Page size (must be a positive integer).
 * @param {?string} [options.after]          Cursor to paginate forwards from.
 * @param {?string} [options.before]         Cursor to paginate backwards from.
 * @param {Object} [options.baseFilter={}]   An existing filter to intersect with.
 * @returns {Promise<PaginationResult>} The page, its cursors and navigation flags.
 * @throws {TypeError} If `executor` is not a function, `limit` is not a positive
 *   integer, or both `after` and `before` are supplied.
 */
export async function paginate({
  executor,
  sortField = "_id",
  sortOrder = 1,
  limit = 20,
  after = null,
  before = null,
  baseFilter = {},
} = {}) {
  if (typeof executor !== "function") {
    throw new TypeError("paginate: executor function is required");
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError("paginate: limit must be a positive integer");
  }
  if (after && before) {
    throw new TypeError("paginate: provide either `after` or `before`, not both");
  }

  const direction = before ? "backward" : "forward";
  const activeCursor = before || after;

  // Compose the base filter with the cursor seek predicate (if any).
  let filter = baseFilter;
  if (activeCursor) {
    const decoded = decodeCursor(activeCursor);
    const seek = buildCursorFilter({ cursor: decoded, sortField, sortOrder, direction });
    filter = mergeFilter(baseFilter, seek);
  }

  const sort = buildSort(sortField, sortOrder, direction);

  // Over-fetch by one to learn whether another page exists in the direction
  // of travel without issuing a second count query.
  const fetched = await executor({ filter, sort, limit: limit + 1 });
  const rows = Array.isArray(fetched) ? fetched : [];

  const hasExtra = rows.length > limit;
  const page = hasExtra ? rows.slice(0, limit) : rows.slice();

  // Backward pages come back nearest-first (reversed); restore caller order.
  const ordered = direction === "backward" ? page.reverse() : page;

  const edges = ordered.map((node) => ({
    node,
    cursor: buildCursorFromDoc(node, sortField),
  }));

  return {
    edges,
    nodes: edges.map((edge) => edge.node),
    pageInfo: {
      hasNextPage: direction === "forward" ? hasExtra : Boolean(activeCursor),
      hasPreviousPage: direction === "backward" ? hasExtra : Boolean(after),
      startCursor: edges.length ? edges[0].cursor : null,
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
    },
  };
}

/**
 * Normalise a value pulled off a document so it survives a JSON round-trip
 * inside a cursor. BSON types such as `ObjectId` and `Date` expose a stable
 * string form; primitives are returned untouched.
 *
 * @param {*} value The raw value from the document.
 * @returns {*} A JSON-safe representation of `value`.
 */
function normaliseValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  // ObjectId and similar BSON types implement a meaningful toString/toHexString.
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") {
      return value.toHexString();
    }
    if (typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
      return value.toString();
    }
  }
  return value;
}

/**
 * Intersect a base filter with a cursor seek predicate without either one
 * clobbering the other's keys (they may both constrain the same field).
 *
 * @param {Object} baseFilter The repository's existing filter.
 * @param {Object} seekFilter The cursor predicate from {@link buildCursorFilter}.
 * @returns {Object} A single MongoDB filter equivalent to `base AND seek`.
 */
function mergeFilter(baseFilter, seekFilter) {
  const base = baseFilter && typeof baseFilter === "object" ? baseFilter : {};
  if (Object.keys(base).length === 0) {
    return seekFilter;
  }
  return { $and: [base, seekFilter] };
}

/**
 * Default export mirrors the named exports for callers that prefer a namespace
 * import: `import cursorPagination from "../utils/cursorPagination.js"`.
 */
export default {
  encodeCursor,
  decodeCursor,
  buildCursorFromDoc,
  buildCursorFilter,
  buildSort,
  paginate,
};
