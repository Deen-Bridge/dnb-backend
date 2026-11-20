/**
 * Guardrails shared by list and search queries.
 */
export const QUERY_MAX_TIME_MS = 5000;
export const QUERY_MAX_RESULTS = 100;
export const SEARCH_MAX_LENGTH = 100;

export function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^\\\${}()|[\]\\]/g, "\\$&");
}

export function boundedSearch(value, maxLength = SEARCH_MAX_LENGTH) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const search = String(value).trim();
  if (search.length > maxLength) {
    throw new Error("Search term must be " + maxLength + " characters or fewer");
  }

  return new RegExp(escapeRegexLiteral(search), "i");
}

export function safeSort(value, allowed, fallback) {
  const requested = String(value || "").trim();
  if (!requested) return fallback;

  const descending = requested.startsWith("-");
  const field = descending ? requested.slice(1) : requested;
  if (!allowed.includes(field)) {
    throw new Error("Unsupported sort field");
  }

  return { [field]: descending ? -1 : 1 };
}
