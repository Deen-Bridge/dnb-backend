// config/serviceKeys.js
//
// Service-to-service (S2S) key store for the AI service (dnb-ai).
//
// Keys are provisioned via the AI_SERVICE_KEYS environment variable, a JSON
// array of key objects:
//
//   [
//     { "kid": "k1", "secret": "long-random-hmac-secret",
//       "scopes": ["ai:read-content"], "active": true }
//   ]
//
// Multiple entries may be active at once, keyed by `kid`, so a new key can be
// introduced and the old one retired WITHOUT downtime (see the rotation
// runbook in docs/service-to-service-auth.md). Each key carries its own
// allowed `scopes`; the requireServiceAuth middleware asserts the route scope.
//
// The parse is memoized against the raw env string so repeated lookups are
// cheap, yet a test (or a hot-reloaded deploy) can mutate process.env and pick
// up the new key set on the next call. Parsing is resilient: a missing or
// malformed value yields an empty Map and NEVER throws at import time.
import logger from "./logger.js";

let cachedRaw;
let cachedMap = new Map();

/**
 * Parse the AI_SERVICE_KEYS env value into a Map<kid, {secret, scopes, active}>.
 * Invalid entries are skipped (and logged) rather than aborting the whole set.
 *
 * @param {string|undefined} raw
 * @returns {Map<string, {secret: string, scopes: string[], active: boolean}>}
 */
function parseServiceKeys(raw) {
  const map = new Map();
  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    return map;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    logger.warn("⚠️  AI_SERVICE_KEYS is not valid JSON — no service keys loaded.");
    return map;
  }

  if (!Array.isArray(parsed)) {
    logger.warn("⚠️  AI_SERVICE_KEYS must be a JSON array — no service keys loaded.");
    return map;
  }

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { kid, secret } = entry;
    if (typeof kid !== "string" || kid === "" || typeof secret !== "string" || secret === "") {
      logger.warn("⚠️  Skipping AI_SERVICE_KEYS entry missing a string kid/secret.");
      continue;
    }
    const scopes = Array.isArray(entry.scopes)
      ? entry.scopes.filter((s) => typeof s === "string")
      : [];
    // Default to active unless explicitly disabled (active:false retires a kid).
    const active = entry.active !== false;
    map.set(kid, { secret, scopes, active });
  }

  return map;
}

/**
 * Return the current service-key Map, re-parsing only when the underlying env
 * value has changed since the last call.
 *
 * @returns {Map<string, {secret: string, scopes: string[], active: boolean}>}
 */
export function getServiceKeys() {
  const raw = process.env.AI_SERVICE_KEYS;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedMap = parseServiceKeys(raw);
  }
  return cachedMap;
}

/**
 * Look up a single key by its `kid`. Returns undefined for unknown ids.
 *
 * @param {string} kid
 * @returns {{secret: string, scopes: string[], active: boolean}|undefined}
 */
export function getServiceKey(kid) {
  if (typeof kid !== "string" || kid === "") return undefined;
  return getServiceKeys().get(kid);
}

/**
 * Force the next getServiceKeys()/getServiceKey() call to re-parse from env.
 * Primarily a test hook for rotating keys mid-suite.
 */
export function resetServiceKeys() {
  cachedRaw = undefined;
  cachedMap = new Map();
}

export default { getServiceKeys, getServiceKey, resetServiceKeys };
