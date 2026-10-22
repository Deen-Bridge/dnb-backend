/**
 * @module mongo/config/readPreference
 * Read-preference configuration for MongoDB replica sets.
 * -------------------------------------------------------------------------
 * Centralises the set of valid Mongoose/MongoDB read-preference modes and
 * provides a small router that maps a logical *query type* (read vs write)
 * onto a concrete read preference. This lets callers route traffic across a
 * replica set — sending writes and read-your-write reads to the primary while
 * off-loading eventually-consistent reads to secondaries.
 *
 * This module is intentionally side-effect free: importing it neither opens a
 * connection nor mutates global Mongoose state. Consumers opt in by calling
 * {@link getReadPreference} (or reading {@link READ_PREFERENCE}) and passing
 * the result to a query/connection.
 *
 * @example
 * import { READ_PREFERENCE, getReadPreference } from "../mongo/config/readPreference.js";
 *
 * // Explicit mode
 * Book.find().read(READ_PREFERENCE.SECONDARY_PREFERRED);
 *
 * // Query-type routing (write → primary, read → secondaryPreferred)
 * Book.find().read(getReadPreference("read"));
 */

/**
 * The MongoDB read-preference modes supported by Mongoose.
 *
 * Values are the wire-level mode strings understood by both the MongoDB driver
 * and Mongoose's `Query.prototype.read()` / connection `readPreference` option.
 *
 * - `PRIMARY`             — read only from the replica-set primary (default).
 * - `PRIMARY_PREFERRED`   — primary if available, otherwise a secondary.
 * - `SECONDARY`           — read only from secondaries.
 * - `SECONDARY_PREFERRED` — secondaries if available, otherwise the primary.
 * - `NEAREST`             — the member with the lowest network latency.
 *
 * @readonly
 * @enum {string}
 */
export const READ_PREFERENCE = Object.freeze({
  PRIMARY: "primary",
  PRIMARY_PREFERRED: "primaryPreferred",
  SECONDARY: "secondary",
  SECONDARY_PREFERRED: "secondaryPreferred",
  NEAREST: "nearest",
});

/**
 * Immutable list of every valid read-preference mode string.
 *
 * Useful for validation (e.g. checking an env-var override against the set of
 * modes the driver accepts).
 *
 * @readonly
 * @type {ReadonlyArray<string>}
 */
export const READ_PREFERENCE_MODES = Object.freeze(
  Object.values(READ_PREFERENCE)
);

/**
 * Default read preference applied when a query type is unknown or unspecified.
 *
 * Defaults to `primary` for the safest, strongly-consistent behaviour, but can
 * be overridden with the `MONGO_READ_PREFERENCE` environment variable. An
 * invalid override is ignored in favour of `primary`.
 *
 * @readonly
 * @type {string}
 */
export const DEFAULT_READ_PREFERENCE = READ_PREFERENCE_MODES.includes(
  process.env.MONGO_READ_PREFERENCE
)
  ? process.env.MONGO_READ_PREFERENCE
  : READ_PREFERENCE.PRIMARY;

/**
 * Read preference used for read-heavy query types when replica reads are
 * enabled. Sourced from `MONGO_READ_REPLICA_PREFERENCE` and falls back to
 * `secondaryPreferred`, which keeps availability if no secondary is reachable.
 *
 * @readonly
 * @type {string}
 */
export const READ_QUERY_PREFERENCE = READ_PREFERENCE_MODES.includes(
  process.env.MONGO_READ_REPLICA_PREFERENCE
)
  ? process.env.MONGO_READ_REPLICA_PREFERENCE
  : READ_PREFERENCE.SECONDARY_PREFERRED;

/**
 * Query types recognised by {@link getReadPreference}.
 *
 * Both a coarse read/write split and the common Mongoose operation names are
 * accepted so callers can pass an operation name directly.
 *
 * @readonly
 * @enum {string}
 */
export const QUERY_TYPE = Object.freeze({
  READ: "read",
  WRITE: "write",
});

/**
 * Mongoose/Mongo operations that mutate data and therefore must target the
 * primary. Anything not listed here is treated as a read.
 *
 * @readonly
 * @type {ReadonlyArray<string>}
 */
const WRITE_OPERATIONS = Object.freeze([
  "write",
  "insert",
  "insertone",
  "insertmany",
  "create",
  "save",
  "update",
  "updateone",
  "updatemany",
  "replaceone",
  "delete",
  "deleteone",
  "deletemany",
  "remove",
  "findoneandupdate",
  "findoneanddelete",
  "findoneandreplace",
  "findbyidandupdate",
  "findbyidanddelete",
  "bulkwrite",
  "aggregate", // may contain $out/$merge write stages — route to primary to be safe
]);

/**
 * Resolve a MongoDB read preference for a given logical query type.
 *
 * Writes (and write-like operations) always resolve to `primary` to guarantee
 * they hit the replica-set primary. Reads resolve to {@link READ_QUERY_PREFERENCE}
 * (default `secondaryPreferred`) so they can be served by secondaries. An
 * unrecognised or empty query type falls back to {@link DEFAULT_READ_PREFERENCE}.
 *
 * @param {string} [queryType="read"] - A {@link QUERY_TYPE} value (`"read"` /
 *   `"write"`) or a Mongoose operation name such as `"find"`, `"updateOne"`,
 *   `"insertMany"`. Matching is case-insensitive.
 * @returns {string} One of the {@link READ_PREFERENCE} mode strings.
 *
 * @example
 * getReadPreference("write");      // → "primary"
 * getReadPreference("updateOne");  // → "primary"
 * getReadPreference("read");       // → "secondaryPreferred"
 * getReadPreference("find");       // → "secondaryPreferred"
 */
export function getReadPreference(queryType = QUERY_TYPE.READ) {
  if (typeof queryType !== "string" || queryType.trim() === "") {
    return DEFAULT_READ_PREFERENCE;
  }

  const normalized = queryType.trim().toLowerCase();

  if (WRITE_OPERATIONS.includes(normalized)) {
    return READ_PREFERENCE.PRIMARY;
  }

  if (normalized === QUERY_TYPE.READ) {
    return READ_QUERY_PREFERENCE;
  }

  if (normalized === QUERY_TYPE.WRITE) {
    return READ_PREFERENCE.PRIMARY;
  }

  // Any other (read-style) operation name — e.g. find/findOne/count/distinct —
  // is safe to serve from a secondary.
  return READ_QUERY_PREFERENCE;
}

/**
 * Type guard that reports whether a value is a valid read-preference mode.
 *
 * @param {unknown} mode - Candidate read-preference string.
 * @returns {boolean} `true` if `mode` is one of {@link READ_PREFERENCE_MODES}.
 *
 * @example
 * isValidReadPreference("nearest");   // → true
 * isValidReadPreference("fastest");   // → false
 */
export function isValidReadPreference(mode) {
  return typeof mode === "string" && READ_PREFERENCE_MODES.includes(mode);
}

/**
 * Default export mirrors the named exports for callers that prefer a namespace
 * import: `import readPreference from "../mongo/config/readPreference.js"`.
 */
export default {
  READ_PREFERENCE,
  READ_PREFERENCE_MODES,
  DEFAULT_READ_PREFERENCE,
  READ_QUERY_PREFERENCE,
  QUERY_TYPE,
  getReadPreference,
  isValidReadPreference,
};
