/**
 * @module mongo/monitoring/poolMetrics
 * MongoDB connection-pool metrics collector.
 * -------------------------------------------------------------------------
 * Subscribes to the MongoDB driver's Connection Monitoring & Pooling (CMAP)
 * events — emitted on the underlying `MongoClient` — and maintains a small set
 * of counters and gauges describing the health of the Mongoose connection
 * pool. A `render()` method serialises the current state as Prometheus text
 * exposition format (v0.0.4) so it can be scraped without any external
 * metrics library.
 *
 * Design constraints
 * ------------------
 *   - **No import-time side effects.** Importing this module only constructs a
 *     singleton with zeroed counters; it never touches the network or requires
 *     a live database. Listeners are attached only when `attach(connection)` is
 *     called at runtime (see `src/config/db.js`, after `mongoose.connect`).
 *   - **Degrades gracefully.** If the client is not yet connected, `attach`
 *     is a no-op that returns `false`; `render()` still emits valid (zeroed)
 *     metrics so the scrape endpoint never fails.
 *   - **Zero dependencies.** The Prometheus text format is hand-rolled using
 *     only stdlib; the collector needs nothing beyond `mongoose` (already a
 *     project dependency) for reading `readyState`.
 *
 * CMAP events consumed (per the MongoDB driver specification):
 *   - `connectionPoolCreated`     — a pool was created for a server
 *   - `connectionPoolReady`       — a pool finished initialising
 *   - `connectionPoolCleared`     — a pool was cleared (e.g. on error)
 *   - `connectionPoolClosed`      — a pool was torn down
 *   - `connectionCreated`         — a physical connection was opened
 *   - `connectionReady`           — a connection finished its handshake
 *   - `connectionClosed`          — a connection was closed
 *   - `connectionCheckOutStarted` — a checkout (borrow) request began
 *   - `connectionCheckOutFailed`  — a checkout request failed (pool error)
 *   - `connectionCheckedOut`      — a connection was borrowed by an operation
 *   - `connectionCheckedIn`       — a connection was returned to the pool
 *
 * From these the collector derives the "in-use / available / pending" gauges
 * that operators care about, plus totals for created/closed/errors.
 */

import mongoose from "mongoose";

const READY_STATE_NAMES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
  99: "uninitialized",
};

/**
 * Collector for MongoDB connection-pool metrics.
 *
 * A single shared instance is exported as the module default. The class is
 * exported too so tests can construct isolated instances and feed synthetic
 * pool events without a live database.
 */
export class PoolMetricsCollector {
  constructor() {
    /** @type {import("mongoose").Connection | null} */
    this._connection = null;
    /** @type {import("mongodb").MongoClient | null} */
    this._client = null;
    this._attached = false;

    // Cumulative counters — monotonically increasing.
    this.counters = {
      poolsCreated: 0,
      poolsReady: 0,
      poolsCleared: 0,
      poolsClosed: 0,
      connectionsCreated: 0,
      connectionsReady: 0,
      connectionsClosed: 0,
      checkOutsStarted: 0,
      checkOutsFailed: 0,
      checkedOut: 0,
      checkedIn: 0,
      connectionErrors: 0,
    };
  }

  /** @returns {boolean} whether pool-event listeners are currently attached */
  isAttached() {
    return this._attached;
  }

  /**
   * Attach CMAP event listeners to a Mongoose connection's underlying client.
   * Safe to call repeatedly and safe to call before a connection exists — in
   * either case it will not throw.
   *
   * @param {import("mongoose").Connection} connection A Mongoose connection.
   * @returns {boolean} true when listeners are (or were already) attached.
   */
  attach(connection) {
    if (!connection) return false;

    let client;
    try {
      client = typeof connection.getClient === "function" ? connection.getClient() : null;
    } catch {
      // getClient() throws when the connection has never been established.
      client = null;
    }
    if (!client || typeof client.on !== "function") return false;

    // Already wired to this exact client — nothing to do.
    if (this._attached && this._client === client) {
      this._connection = connection;
      return true;
    }

    this._connection = connection;
    this._client = client;

    client.on("connectionPoolCreated", () => {
      this.counters.poolsCreated += 1;
    });
    client.on("connectionPoolReady", () => {
      this.counters.poolsReady += 1;
    });
    client.on("connectionPoolCleared", () => {
      this.counters.poolsCleared += 1;
    });
    client.on("connectionPoolClosed", () => {
      this.counters.poolsClosed += 1;
    });
    client.on("connectionCreated", () => {
      this.counters.connectionsCreated += 1;
    });
    client.on("connectionReady", () => {
      this.counters.connectionsReady += 1;
    });
    client.on("connectionClosed", () => {
      this.counters.connectionsClosed += 1;
    });
    client.on("connectionCheckOutStarted", () => {
      this.counters.checkOutsStarted += 1;
    });
    client.on("connectionCheckOutFailed", () => {
      this.counters.checkOutsFailed += 1;
      this.counters.connectionErrors += 1;
    });
    client.on("connectionCheckedOut", () => {
      this.counters.checkedOut += 1;
    });
    client.on("connectionCheckedIn", () => {
      this.counters.checkedIn += 1;
    });

    // Connection-level errors (auth failure, socket errors, etc.).
    if (typeof connection.on === "function") {
      connection.on("error", () => {
        this.counters.connectionErrors += 1;
      });
    }

    this._attached = true;
    return true;
  }

  /**
   * Compute the live pool state derived from the accumulated counters plus the
   * current connection `readyState` and configured pool sizes.
   *
   * @returns {{
   *   readyState: number,
   *   readyStateName: string,
   *   maxPoolSize: number|null,
   *   minPoolSize: number|null,
   *   open: number,
   *   inUse: number,
   *   available: number,
   *   pending: number
   * }}
   */
  snapshot() {
    const c = this.counters;

    // Currently open (physical) connections = created − closed.
    const open = Math.max(0, c.connectionsCreated - c.connectionsClosed);
    // In-use connections = checked out − checked in.
    const inUse = Math.max(0, c.checkedOut - c.checkedIn);
    // Available = open connections not currently borrowed.
    const available = Math.max(0, open - inUse);
    // Pending = checkout requests started but not yet satisfied or failed.
    // Approximates the wait-queue depth.
    const pending = Math.max(
      0,
      c.checkOutsStarted - c.checkedOut - c.checkOutsFailed
    );

    const connection = this._connection || mongoose.connection;
    const readyState =
      connection && typeof connection.readyState === "number"
        ? connection.readyState
        : 0;

    let maxPoolSize = null;
    let minPoolSize = null;
    const options = this._client && this._client.options;
    if (options) {
      if (typeof options.maxPoolSize === "number") maxPoolSize = options.maxPoolSize;
      if (typeof options.minPoolSize === "number") minPoolSize = options.minPoolSize;
    }

    return {
      readyState,
      readyStateName: READY_STATE_NAMES[readyState] || "unknown",
      maxPoolSize,
      minPoolSize,
      open,
      inUse,
      available,
      pending,
    };
  }

  /**
   * Serialise the current metrics as Prometheus text exposition format.
   * Each metric carries a constant `{pool="mongodb"}` label so the output is a
   * valid `metric_name{labels} value` series.
   *
   * @returns {string} Prometheus-formatted metrics text (newline-terminated).
   */
  render() {
    const s = this.snapshot();
    const c = this.counters;
    const L = 'pool="mongodb"';
    const lines = [];

    const metric = (name, type, help, samples) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      for (const [labels, value] of samples) {
        lines.push(`${name}{${labels}} ${value}`);
      }
    };

    metric(
      "mongodb_pool_connections_open",
      "gauge",
      "Current number of open connections in the MongoDB pool.",
      [[L, s.open]]
    );
    metric(
      "mongodb_pool_connections_in_use",
      "gauge",
      "Connections currently checked out (in use) from the pool.",
      [[L, s.inUse]]
    );
    metric(
      "mongodb_pool_connections_available",
      "gauge",
      "Open connections currently available (idle) in the pool.",
      [[L, s.available]]
    );
    metric(
      "mongodb_pool_wait_queue_size",
      "gauge",
      "Pending checkout requests waiting for an available connection.",
      [[L, s.pending]]
    );
    metric(
      "mongodb_pool_max_size",
      "gauge",
      "Configured maximum pool size (maxPoolSize).",
      [[L, s.maxPoolSize == null ? 0 : s.maxPoolSize]]
    );
    metric(
      "mongodb_pool_min_size",
      "gauge",
      "Configured minimum pool size (minPoolSize).",
      [[L, s.minPoolSize == null ? 0 : s.minPoolSize]]
    );
    metric(
      "mongodb_connection_ready_state",
      "gauge",
      "Mongoose connection readyState (0=disconnected,1=connected,2=connecting,3=disconnecting).",
      [[`${L},state="${s.readyStateName}"`, s.readyState]]
    );

    metric(
      "mongodb_pool_connections_created_total",
      "counter",
      "Total physical connections created since process start.",
      [[L, c.connectionsCreated]]
    );
    metric(
      "mongodb_pool_connections_ready_total",
      "counter",
      "Total connections that completed their handshake and became ready.",
      [[L, c.connectionsReady]]
    );
    metric(
      "mongodb_pool_connections_closed_total",
      "counter",
      "Total physical connections closed since process start.",
      [[L, c.connectionsClosed]]
    );
    metric(
      "mongodb_pool_checkouts_started_total",
      "counter",
      "Total connection checkout (borrow) attempts started.",
      [[L, c.checkOutsStarted]]
    );
    metric(
      "mongodb_pool_checkouts_total",
      "counter",
      "Total successful connection checkouts.",
      [[L, c.checkedOut]]
    );
    metric(
      "mongodb_pool_checkins_total",
      "counter",
      "Total connections returned (checked in) to the pool.",
      [[L, c.checkedIn]]
    );
    metric(
      "mongodb_pool_checkout_failures_total",
      "counter",
      "Total connection checkout attempts that failed.",
      [[L, c.checkOutsFailed]]
    );
    metric(
      "mongodb_pool_errors_total",
      "counter",
      "Total connection-pool and connection errors observed.",
      [[L, c.connectionErrors]]
    );
    metric(
      "mongodb_pool_pools_created_total",
      "counter",
      "Total connection pools created (one per server/topology member).",
      [[L, c.poolsCreated]]
    );
    metric(
      "mongodb_pool_pools_cleared_total",
      "counter",
      "Total times a connection pool was cleared.",
      [[L, c.poolsCleared]]
    );

    return lines.join("\n") + "\n";
  }
}

/**
 * Shared singleton used by the metrics route and the DB bootstrap.
 * @type {PoolMetricsCollector}
 */
const poolMetrics = new PoolMetricsCollector();

export default poolMetrics;
