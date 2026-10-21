/**
 * @module mongo/connection/replicaSet
 * Replica-set connection helpers for MongoDB / Mongoose.
 * -------------------------------------------------------------------------
 * Builds Mongoose connection options wired for a replica set with a chosen
 * read preference, and attaches connection-event listeners that provide basic
 * failover monitoring via structured logging (connected / disconnected /
 * reconnected / error).
 *
 * This module is intentionally side-effect free at import time: it neither
 * connects nor mutates global Mongoose state until one of its functions is
 * explicitly invoked. This keeps server boot and `node --check` safe and lets
 * the existing connection code in `src/config/db.js` remain untouched — callers
 * opt in to replica-set routing rather than having it forced on them.
 *
 * @example
 * import mongoose from "mongoose";
 * import { connectReplicaSet } from "../mongo/connection/replicaSet.js";
 *
 * await connectReplicaSet(mongoose, {
 *   uri: process.env.MONGO_URI,
 *   replicaSet: "rs0",
 *   readPreference: "secondaryPreferred",
 * });
 */

import { getReadPreference, isValidReadPreference, READ_PREFERENCE } from "../config/readPreference.js";

/**
 * Minimal logger shape used by this module.
 * @typedef {Object} ReplicaSetLogger
 * @property {(...args: any[]) => void} info
 * @property {(...args: any[]) => void} warn
 * @property {(...args: any[]) => void} error
 */

/**
 * Resolve a usable logger. Prefers the shared pino logger at
 * `src/config/logger.js`; if it cannot be loaded (e.g. in a trimmed test
 * environment) falls back to the global `console`. Loading is lazy and guarded
 * so that importing this module never throws.
 *
 * @param {ReplicaSetLogger} [override] - Explicit logger to use instead.
 * @returns {Promise<ReplicaSetLogger>} A logger with info/warn/error methods.
 */
async function resolveLogger(override) {
  if (override && typeof override.info === "function") {
    return override;
  }
  try {
    const mod = await import("../../src/config/logger.js");
    return mod.default || console;
  } catch {
    return console;
  }
}

/**
 * Build a Mongoose connection options object configured for a replica set.
 *
 * Merges sensible replica-set defaults (connection pool sizing, timeouts,
 * majority writes with retryable writes/reads) with the requested read
 * preference and any caller overrides. Pure function — it performs no I/O and
 * has no side effects.
 *
 * Environment variables consulted for defaults:
 *   - `MONGO_REPLICA_SET`          — replica-set name (`replicaSet`).
 *   - `MONGO_READ_PREFERENCE`      — default read preference mode.
 *   - `MONGO_MAX_POOL_SIZE`        — max pool size (default 10).
 *   - `MONGO_MIN_POOL_SIZE`        — min pool size (default 5).
 *
 * @param {Object} [config={}] - Connection configuration.
 * @param {string} [config.replicaSet] - Replica-set name.
 * @param {string} [config.readPreference] - A valid read-preference mode
 *   (see {@link module:mongo/config/readPreference.READ_PREFERENCE}). Invalid
 *   values are ignored in favour of the default.
 * @param {number} [config.maxPoolSize] - Maximum connection-pool size.
 * @param {number} [config.minPoolSize] - Minimum connection-pool size.
 * @param {number} [config.serverSelectionTimeoutMS=5000] - Server-selection timeout.
 * @param {number} [config.socketTimeoutMS=45000] - Socket timeout.
 * @param {Object} [config.overrides] - Extra Mongoose options merged last,
 *   taking precedence over every computed value.
 * @returns {import("mongoose").ConnectOptions} Mongoose connection options.
 *
 * @example
 * const opts = buildReplicaSetOptions({ replicaSet: "rs0", readPreference: "nearest" });
 */
export function buildReplicaSetOptions(config = {}) {
  const requestedPreference = config.readPreference ?? process.env.MONGO_READ_PREFERENCE;
  const readPreference = isValidReadPreference(requestedPreference)
    ? requestedPreference
    : getReadPreference("read");

  const replicaSet = config.replicaSet ?? process.env.MONGO_REPLICA_SET;

  const options = {
    maxPoolSize:
      config.maxPoolSize ?? parseInt(process.env.MONGO_MAX_POOL_SIZE || "10", 10),
    minPoolSize:
      config.minPoolSize ?? parseInt(process.env.MONGO_MIN_POOL_SIZE || "5", 10),
    serverSelectionTimeoutMS: config.serverSelectionTimeoutMS ?? 5000,
    socketTimeoutMS: config.socketTimeoutMS ?? 45000,
    retryWrites: true,
    retryReads: true,
    w: "majority",
    readPreference,
    ...(replicaSet ? { replicaSet } : {}),
    ...(config.overrides || {}),
  };

  return options;
}

/**
 * Attach replica-set monitoring/failover listeners to a Mongoose connection.
 *
 * Registers handlers for the `connected`, `disconnected`, `reconnected` and
 * `error` events and logs each transition. These provide lightweight failover
 * observability — a `disconnected`/`reconnected` pair typically corresponds to
 * a primary step-down and re-election within the replica set.
 *
 * Idempotent: a guard flag on the connection prevents duplicate registration if
 * called more than once for the same connection.
 *
 * @param {import("mongoose").Connection} connection - The Mongoose connection
 *   (e.g. `mongoose.connection`) to instrument.
 * @param {Object} [options={}] - Options.
 * @param {ReplicaSetLogger} [options.logger] - Logger override; defaults to the
 *   shared pino logger with a `console` fallback.
 * @returns {Promise<import("mongoose").Connection>} The same connection, for chaining.
 *
 * @example
 * await attachConnectionListeners(mongoose.connection);
 */
export async function attachConnectionListeners(connection, options = {}) {
  if (!connection || typeof connection.on !== "function") {
    throw new TypeError("attachConnectionListeners: a Mongoose connection is required");
  }

  // Guard against double registration on the same connection object.
  if (connection.__replicaSetListenersAttached) {
    return connection;
  }
  Object.defineProperty(connection, "__replicaSetListenersAttached", {
    value: true,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  const logger = await resolveLogger(options.logger);

  connection.on("connected", () => {
    logger.info(
      { host: connection.host, name: connection.name },
      "MongoDB replica set connected"
    );
  });

  connection.on("reconnected", () => {
    logger.info("MongoDB replica set reconnected (failover recovered)");
  });

  connection.on("disconnected", () => {
    logger.warn("MongoDB replica set disconnected (possible primary step-down / failover)");
  });

  connection.on("error", (err) => {
    logger.error(err, "MongoDB replica set connection error");
  });

  return connection;
}

/**
 * Connect Mongoose to a replica set with read-preference routing and attach
 * monitoring/failover listeners.
 *
 * Convenience wrapper combining {@link buildReplicaSetOptions} and
 * {@link attachConnectionListeners}. It does nothing until called, so importing
 * this module remains side-effect free.
 *
 * @param {import("mongoose")} mongoose - The Mongoose instance to connect with.
 * @param {Object} [config={}] - Configuration.
 * @param {string} [config.uri] - Connection string; defaults to `process.env.MONGO_URI`.
 * @param {string} [config.replicaSet] - Replica-set name.
 * @param {string} [config.readPreference] - Read-preference mode.
 * @param {number} [config.maxPoolSize] - Max pool size.
 * @param {number} [config.minPoolSize] - Min pool size.
 * @param {number} [config.serverSelectionTimeoutMS] - Server-selection timeout.
 * @param {number} [config.socketTimeoutMS] - Socket timeout.
 * @param {Object} [config.overrides] - Extra Mongoose options.
 * @param {ReplicaSetLogger} [config.logger] - Logger override.
 * @returns {Promise<import("mongoose").Connection>} The active connection.
 * @throws {Error} If no URI is provided (and `MONGO_URI` is unset) or the
 *   underlying `mongoose.connect` rejects.
 *
 * @example
 * import mongoose from "mongoose";
 * await connectReplicaSet(mongoose, { readPreference: "secondaryPreferred" });
 */
export async function connectReplicaSet(mongoose, config = {}) {
  if (!mongoose || typeof mongoose.connect !== "function") {
    throw new TypeError("connectReplicaSet: a Mongoose instance is required");
  }

  const uri = config.uri ?? process.env.MONGO_URI;
  if (!uri) {
    throw new Error(
      "connectReplicaSet: no connection URI provided (set MONGO_URI or pass config.uri)"
    );
  }

  const options = buildReplicaSetOptions(config);

  // Attach listeners before connecting so the initial `connected` event is caught.
  await attachConnectionListeners(mongoose.connection, { logger: config.logger });

  await mongoose.connect(uri, options);
  return mongoose.connection;
}

/**
 * Default export mirrors the named exports for callers that prefer a namespace
 * import: `import replicaSet from "../mongo/connection/replicaSet.js"`.
 */
export default {
  READ_PREFERENCE,
  buildReplicaSetOptions,
  attachConnectionListeners,
  connectReplicaSet,
};
