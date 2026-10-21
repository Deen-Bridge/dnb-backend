import { EventEmitter } from "node:events";
import { PoolMetricsCollector } from "../poolMetrics.js";

/**
 * Builds a fake Mongoose connection whose `getClient()` returns an
 * EventEmitter standing in for the MongoDB driver's MongoClient. This lets us
 * drive CMAP pool events synthetically, with no live database.
 */
function makeFakeConnection({ readyState = 1, maxPoolSize = 10, minPoolSize = 5 } = {}) {
  const client = new EventEmitter();
  client.options = { maxPoolSize, minPoolSize };

  const connection = new EventEmitter();
  connection.readyState = readyState;
  connection.getClient = () => client;

  return { connection, client };
}

describe("PoolMetricsCollector", () => {
  test("importing/constructing has no side effects and renders zeroed metrics", () => {
    const collector = new PoolMetricsCollector();
    expect(collector.isAttached()).toBe(false);

    const out = collector.render();
    // Prometheus format sanity: HELP/TYPE headers and a labelled sample line.
    expect(out).toMatch(/# HELP mongodb_pool_connections_open /);
    expect(out).toMatch(/# TYPE mongodb_pool_connections_open gauge/);
    expect(out).toMatch(/mongodb_pool_connections_open\{pool="mongodb"\} 0/);
    expect(out.endsWith("\n")).toBe(true);
  });

  test("attach is idempotent and returns false without a client", () => {
    const collector = new PoolMetricsCollector();
    expect(collector.attach(null)).toBe(false);
    expect(collector.attach({})).toBe(false); // no getClient()

    const { connection, client } = makeFakeConnection();
    expect(collector.attach(connection)).toBe(true);
    expect(collector.isAttached()).toBe(true);

    // Re-attaching to the same client should not double-register listeners.
    const before = client.listenerCount("connectionCreated");
    expect(collector.attach(connection)).toBe(true);
    expect(client.listenerCount("connectionCreated")).toBe(before);
  });

  test("counters and derived gauges track synthetic CMAP events", () => {
    const collector = new PoolMetricsCollector();
    const { connection, client } = makeFakeConnection({ readyState: 1 });
    collector.attach(connection);

    // Simulate a pool coming up with three connections.
    client.emit("connectionPoolCreated");
    client.emit("connectionPoolReady");
    for (let i = 0; i < 3; i += 1) {
      client.emit("connectionCreated");
      client.emit("connectionReady");
    }

    // Two operations borrow connections; one is returned.
    client.emit("connectionCheckOutStarted");
    client.emit("connectionCheckedOut");
    client.emit("connectionCheckOutStarted");
    client.emit("connectionCheckedOut");
    client.emit("connectionCheckedIn");

    // One checkout fails (counts as an error too).
    client.emit("connectionCheckOutStarted");
    client.emit("connectionCheckOutFailed");

    // One connection closed; one connection-level error.
    client.emit("connectionClosed");
    connection.emit("error", new Error("socket reset"));

    const snap = collector.snapshot();
    expect(snap.open).toBe(2); // 3 created − 1 closed
    expect(snap.inUse).toBe(1); // 2 checked out − 1 checked in
    expect(snap.available).toBe(1); // 2 open − 1 in use
    expect(snap.pending).toBe(0); // 3 started − 2 out − 1 failed
    expect(snap.maxPoolSize).toBe(10);
    expect(snap.minPoolSize).toBe(5);
    expect(snap.readyState).toBe(1);
    expect(snap.readyStateName).toBe("connected");

    expect(collector.counters.connectionsCreated).toBe(3);
    expect(collector.counters.connectionsClosed).toBe(1);
    expect(collector.counters.checkOutsFailed).toBe(1);
    // checkout failure + connection error → 2 total errors.
    expect(collector.counters.connectionErrors).toBe(2);
  });

  test("render emits Prometheus lines reflecting the collected state", () => {
    const collector = new PoolMetricsCollector();
    const { connection, client } = makeFakeConnection({ readyState: 1 });
    collector.attach(connection);

    client.emit("connectionCreated");
    client.emit("connectionCreated");
    client.emit("connectionCheckOutStarted");
    client.emit("connectionCheckedOut");

    const out = collector.render();

    expect(out).toContain('mongodb_pool_connections_created_total{pool="mongodb"} 2');
    expect(out).toContain('mongodb_pool_connections_open{pool="mongodb"} 2');
    expect(out).toContain('mongodb_pool_connections_in_use{pool="mongodb"} 1');
    expect(out).toContain('mongodb_pool_max_size{pool="mongodb"} 10');
    expect(out).toContain(
      'mongodb_connection_ready_state{pool="mongodb",state="connected"} 1'
    );

    // Every metric must carry both a HELP and a TYPE header.
    const helpCount = (out.match(/# HELP /g) || []).length;
    const typeCount = (out.match(/# TYPE /g) || []).length;
    expect(helpCount).toBe(typeCount);
    expect(helpCount).toBeGreaterThanOrEqual(15);
  });
});
