/**
 * @module mongo/utils/pagination
 * Standardized pagination utility for MongoDB data access.
 * -------------------------------------------------------------------------
 * Supports both offset-based and cursor-based pagination, returning consistent
 * response formats with rich metadata (total count, page boundaries, hasNext,
 * hasPrevious, and cursor tokens).
 *
 * Why standardized pagination?
 * ----------------------------
 *   - **Consistency.** API consumers get a predictable payload structure
 *     whether a collection uses offset or cursor pagination.
 *   - **Flexibility.** Seamlessly handles offset mode (`page`, `offset`, `limit`)
 *     and cursor mode (`cursor`, `after`, `before`).
 *   - **Decoupled execution.** Storage-agnostic: repository code injects an
 *     `executor` and optional `countExecutor`, keeping pagination logic pure.
 *
 * Response Structure
 * ------------------
 * ```js
 * {
 *   data: [ ... ],
 *   meta: {
 *     total: 100,           // total count (if available / requested)
 *     page: 1,              // 1-based page number (offset mode)
 *     limit: 20,            // page size
 *     totalPages: 5,        // total pages (offset mode)
 *     offset: 0,            // skip offset (offset mode)
 *     hasNext: true,        // whether more records exist forward
 *     hasPrevious: false,   // whether more records exist backward
 *     startCursor: "...",   // cursor of first item in page (cursor mode)
 *     endCursor: "...",     // cursor of last item in page (cursor mode)
 *     nextCursor: "...",    // token for next page (cursor mode)
 *     prevCursor: "..."     // token for previous page (cursor mode)
 *   },
 *   // Top-level aliases for direct access & backward compatibility
 *   total: 100,
 *   page: 1,
 *   limit: 20,
 *   totalPages: 5,
 *   offset: 0,
 *   hasNext: true,
 *   hasPrevious: false,
 *   hasNextPage: true,
 *   hasPrevPage: false,
 *   nextCursor: "...",
 *   prevCursor: "..."
 * }
 * ```
 */

import cursorPagination, {
  encodeCursor,
  decodeCursor,
  buildCursorFromDoc,
  buildCursorFilter,
  buildSort,
  paginate as cursorPaginate,
} from "./cursorPagination.js";

/** Default page size when unspecified */
export const DEFAULT_LIMIT = 20;

/** Maximum allowable page size */
export const MAX_LIMIT = 100;

/**
 * Clamp caller-supplied limit into [1, MAX_LIMIT].
 *
 * @param {*} value - Raw limit input.
 * @param {number} [defaultLimit=DEFAULT_LIMIT] - Fallback limit.
 * @param {number} [maxLimit=MAX_LIMIT] - Ceiling limit.
 * @returns {number} Clamped limit integer.
 */
export function resolveLimit(value, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) {
  let limit = parseInt(value ?? defaultLimit, 10);
  if (Number.isNaN(limit) || limit < 1) {
    limit = defaultLimit;
  }
  if (limit > maxLimit) {
    limit = maxLimit;
  }
  return limit;
}

/**
 * Format pagination metadata into a standardized object.
 *
 * @param {Object} params
 * @param {number|null} [params.total=null] Total count of matching records.
 * @param {number|null} [params.page=null] 1-based page number.
 * @param {number} [params.limit=DEFAULT_LIMIT] Page size.
 * @param {number|null} [params.totalPages=null] Computed total pages.
 * @param {number|null} [params.offset=null] Computed offset skip.
 * @param {boolean} [params.hasNext=false] Whether next page exists.
 * @param {boolean} [params.hasPrevious=false] Whether previous page exists.
 * @param {string|null} [params.startCursor=null] First item's cursor.
 * @param {string|null} [params.endCursor=null] Last item's cursor.
 * @param {string|null} [params.nextCursor=null] Continuation cursor for next page.
 * @param {string|null} [params.prevCursor=null] Continuation cursor for previous page.
 * @returns {Object} Standardized metadata object.
 */
export function formatPaginationMeta({
  total = null,
  page = null,
  limit = DEFAULT_LIMIT,
  totalPages = null,
  offset = null,
  hasNext = false,
  hasPrevious = false,
  startCursor = null,
  endCursor = null,
  nextCursor = null,
  prevCursor = null,
} = {}) {
  return {
    total: typeof total === "number" && !Number.isNaN(total) ? total : null,
    page: typeof page === "number" && page > 0 ? page : null,
    limit: resolveLimit(limit),
    totalPages: typeof totalPages === "number" && totalPages >= 0 ? totalPages : null,
    offset: typeof offset === "number" && offset >= 0 ? offset : null,
    hasNext: Boolean(hasNext),
    hasPrevious: Boolean(hasPrevious),
    startCursor: startCursor ?? null,
    endCursor: endCursor ?? null,
    nextCursor: nextCursor ?? null,
    prevCursor: prevCursor ?? null,
  };
}

/**
 * Build standardized pagination response object containing data and metadata.
 *
 * @param {Array} [data=[]] Page of items.
 * @param {Object} [metaParams={}] Metadata parameters for formatPaginationMeta.
 * @returns {Object} Standardized pagination response.
 */
export function formatPaginationResponse(data = [], metaParams = {}) {
  const meta = formatPaginationMeta(metaParams);
  const items = Array.isArray(data) ? data : [];

  return {
    data: items,
    meta,

    // Top-level aliases for direct property access and backward compatibility
    total: meta.total,
    page: meta.page,
    limit: meta.limit,
    totalPages: meta.totalPages,
    offset: meta.offset,
    hasNext: meta.hasNext,
    hasPrevious: meta.hasPrevious,
    hasNextPage: meta.hasNext,
    hasPrevPage: meta.hasPrevious,
    startCursor: meta.startCursor,
    endCursor: meta.endCursor,
    nextCursor: meta.nextCursor,
    prevCursor: meta.prevCursor,
  };
}

/**
 * Execute offset-based pagination.
 *
 * @param {Object} params
 * @param {(query: {filter: Object, sort: Object, limit: number, skip: number}) => (Array|Promise<Array>)} params.executor
 *        Function running query against data store.
 * @param {(query: {filter: Object}) => (number|Promise<number>)} [params.countExecutor]
 *        Function fetching total document count.
 * @param {number} [params.total] Pre-calculated total count.
 * @param {number} [params.page=1] 1-based page number.
 * @param {number} [params.offset] Explicit offset override.
 * @param {number} [params.limit=20] Page size limit (clamped [1, 100]).
 * @param {Object} [params.filter={}] Filter criteria.
 * @param {Object|string} [params.sort] Sort specification.
 * @param {string} [params.sortBy="_id"] Primary sort field (when sort option omitted).
 * @param {("asc"|"desc"|1|-1)} [params.order="desc"] Sort direction (when sort option omitted).
 * @returns {Promise<Object>} Standardized pagination result.
 */
export async function paginateOffset({
  executor,
  countExecutor,
  total: precomputedTotal,
  page: rawPage = 1,
  offset: explicitOffset,
  limit: rawLimit = DEFAULT_LIMIT,
  filter = {},
  sort,
  sortBy = "_id",
  order = "desc",
} = {}) {
  if (typeof executor !== "function") {
    throw new TypeError("paginateOffset: executor function is required");
  }

  const limit = resolveLimit(rawLimit);
  let page = parseInt(rawPage, 10);
  if (Number.isNaN(page) || page < 1) {
    page = 1;
  }

  const offset = Number.isFinite(explicitOffset) && explicitOffset >= 0
    ? Math.floor(explicitOffset)
    : (page - 1) * limit;

  // Resolve sort specification
  let sortSpec = sort;
  if (!sortSpec) {
    const sortField = String(sortBy).trim();
    if (!sortField) {
      throw new TypeError("paginateOffset: sortBy cannot be empty");
    }
    const dir = String(order).toLowerCase() === "asc" || order === 1 ? 1 : -1;
    sortSpec = { [sortField]: dir };
  }

  // Execute query and count concurrently if countExecutor available
  const promises = [
    executor({ filter, sort: sortSpec, limit, skip: offset }),
  ];

  const shouldCount = typeof precomputedTotal !== "number" && typeof countExecutor === "function";
  if (shouldCount) {
    promises.push(countExecutor({ filter }));
  }

  const [fetchedData, countedTotal] = await Promise.all(promises);
  const data = Array.isArray(fetchedData) ? fetchedData : [];

  let total = null;
  if (typeof precomputedTotal === "number") {
    total = precomputedTotal;
  } else if (shouldCount) {
    total = typeof countedTotal === "number" ? countedTotal : 0;
  }

  let totalPages = null;
  let hasNext = false;
  if (total !== null) {
    totalPages = Math.ceil(total / limit);
    hasNext = offset + data.length < total;
  } else {
    // Without total count, infer hasNext if a full page was returned
    hasNext = data.length >= limit;
  }

  const hasPrevious = offset > 0 || page > 1;

  return formatPaginationResponse(data, {
    total,
    page,
    limit,
    totalPages,
    offset,
    hasNext,
    hasPrevious,
  });
}

/**
 * Execute cursor-based pagination.
 *
 * @param {Object} params
 * @param {(query: {filter: Object, sort: Object, limit: number}) => (Array|Promise<Array>)} params.executor
 *        Function running query against data store.
 * @param {(query: {filter: Object}) => (number|Promise<number>)} [params.countExecutor]
 *        Function fetching total document count.
 * @param {number} [params.total] Pre-calculated total count.
 * @param {boolean} [params.includeTotal=false] Whether to compute total count via countExecutor.
 * @param {string} [params.sortField="_id"] Sort field.
 * @param {(1|-1|"asc"|"desc")} [params.sortOrder=1] Sort order.
 * @param {number} [params.limit=20] Page size limit.
 * @param {?string} [params.cursor] Continuation cursor (alias for after).
 * @param {?string} [params.after] Forward pagination cursor.
 * @param {?string} [params.before] Backward pagination cursor.
 * @param {Object} [params.filter={}] Filter criteria.
 * @returns {Promise<Object>} Standardized pagination result.
 */
export async function paginateCursor({
  executor,
  countExecutor,
  total: precomputedTotal,
  includeTotal = false,
  sortField = "_id",
  sortOrder = 1,
  limit: rawLimit = DEFAULT_LIMIT,
  cursor,
  after,
  before,
  filter = {},
} = {}) {
  if (typeof executor !== "function") {
    throw new TypeError("paginateCursor: executor function is required");
  }

  const limit = resolveLimit(rawLimit);
  const activeAfter = after || cursor || null;

  // Resolve sort order numeric direction
  let numericSortOrder = sortOrder;
  if (typeof sortOrder === "string") {
    numericSortOrder = sortOrder.toLowerCase() === "desc" ? -1 : 1;
  }

  const promises = [
    cursorPaginate({
      executor,
      sortField,
      sortOrder: numericSortOrder,
      limit,
      after: activeAfter,
      before: before || null,
      baseFilter: filter,
    }),
  ];

  const shouldCount = typeof precomputedTotal !== "number" && includeTotal && typeof countExecutor === "function";
  if (shouldCount) {
    promises.push(countExecutor({ filter }));
  }

  const [cursorResult, countedTotal] = await Promise.all(promises);

  let total = null;
  if (typeof precomputedTotal === "number") {
    total = precomputedTotal;
  } else if (shouldCount) {
    total = typeof countedTotal === "number" ? countedTotal : 0;
  }

  const { nodes, pageInfo } = cursorResult;
  const startCursor = pageInfo.startCursor;
  const endCursor = pageInfo.endCursor;
  const hasNext = pageInfo.hasNextPage;
  const hasPrevious = pageInfo.hasPreviousPage;
  const nextCursor = hasNext ? endCursor : null;
  const prevCursor = hasPrevious ? startCursor : null;

  return formatPaginationResponse(nodes, {
    total,
    limit,
    hasNext,
    hasPrevious,
    startCursor,
    endCursor,
    nextCursor,
    prevCursor,
  });
}

/**
 * Standardized master pagination entry point. Auto-detects cursor mode vs offset mode
 * based on parameters unless `options.mode` is explicitly passed.
 *
 * @param {Object} params - Pagination parameters (supports offset and cursor parameters).
 * @param {("offset"|"cursor")} [params.mode] Explicit pagination mode.
 * @returns {Promise<Object>} Standardized pagination result.
 */
export async function paginate(params = {}) {
  const isCursorMode =
    params.mode === "cursor" ||
    (!params.mode && (Boolean(params.cursor) || Boolean(params.after) || Boolean(params.before)));

  if (isCursorMode) {
    return paginateCursor(params);
  }
  return paginateOffset(params);
}

export {
  encodeCursor,
  decodeCursor,
  buildCursorFromDoc,
  buildCursorFilter,
  buildSort,
};

export default {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  resolveLimit,
  formatPaginationMeta,
  formatPaginationResponse,
  paginateOffset,
  paginateCursor,
  paginate,
  encodeCursor,
  decodeCursor,
  buildCursorFromDoc,
  buildCursorFilter,
  buildSort,
};
