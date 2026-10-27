/**
 * Shared pagination helpers. Clamp client-supplied page/limit values so list
 * endpoints can never be asked for an unbounded number of documents.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

const toInt = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * @param {object} query - typically req.query
 * @param {{defaultLimit?: number, maxLimit?: number}} [opts]
 * @returns {{page: number, limit: number, skip: number}}
 */
export function parsePagination(
  query = {},
  { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}
) {
  const rawPage = toInt(query?.page);
  const rawLimit = toInt(query?.limit);
  const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const base = Number.isNaN(rawLimit) || rawLimit < 1 ? defaultLimit : rawLimit;
  const limit = Math.min(Math.max(base, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * @returns {{page: number, limit: number, total: number, pages: number}}
 */
export function buildPageMeta(total, page, pageSize) {
  const safeTotal = Math.max(0, Number(total) || 0);
  return {
    page,
    limit: pageSize,
    total: safeTotal,
    pages: pageSize > 0 ? Math.ceil(safeTotal / pageSize) : 0,
  };
}
