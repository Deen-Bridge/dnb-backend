# MongoDB Connection Pool Metrics

The API exposes MongoDB connection-pool statistics in **Prometheus text
exposition format** so pool health can be scraped and dashboarded.

- **Endpoint:** `GET /metrics/database`
- **Content-Type:** `text/plain; version=0.0.4; charset=utf-8`
- **Collector:** `mongo/monitoring/poolMetrics.js`
- **Route:** `src/routes/metrics/database.js` (mounted in `app.js`)

The collector subscribes to the MongoDB driver's Connection Monitoring &
Pooling (CMAP) events on the live `MongoClient` (wired up in
`src/config/db.js` after `mongoose.connect`). It has no import-time side
effects and degrades gracefully: if the database is not yet connected the
endpoint still returns valid, zeroed metrics.

## Exposed metrics

| Metric | Type | Meaning |
| --- | --- | --- |
| `mongodb_pool_connections_open` | gauge | Open physical connections (`created − closed`). |
| `mongodb_pool_connections_in_use` | gauge | Connections currently checked out. |
| `mongodb_pool_connections_available` | gauge | Idle connections available to borrow. |
| `mongodb_pool_wait_queue_size` | gauge | Pending checkout requests (wait-queue depth). |
| `mongodb_pool_max_size` | gauge | Configured `maxPoolSize`. |
| `mongodb_pool_min_size` | gauge | Configured `minPoolSize`. |
| `mongodb_connection_ready_state` | gauge | Mongoose `readyState` (0–3), with a `state` label. |
| `mongodb_pool_connections_created_total` | counter | Physical connections created. |
| `mongodb_pool_connections_ready_total` | counter | Connections that finished their handshake. |
| `mongodb_pool_connections_closed_total` | counter | Physical connections closed. |
| `mongodb_pool_checkouts_started_total` | counter | Checkout attempts started. |
| `mongodb_pool_checkouts_total` | counter | Successful checkouts. |
| `mongodb_pool_checkins_total` | counter | Connections returned to the pool. |
| `mongodb_pool_checkout_failures_total` | counter | Failed checkout attempts. |
| `mongodb_pool_errors_total` | counter | Pool + connection errors observed. |
| `mongodb_pool_pools_created_total` | counter | Pools created (one per topology member). |
| `mongodb_pool_pools_cleared_total` | counter | Pool clear events. |

Every series carries a constant `pool="mongodb"` label.

### Sample output

```text
# HELP mongodb_pool_connections_open Current number of open connections in the MongoDB pool.
# TYPE mongodb_pool_connections_open gauge
mongodb_pool_connections_open{pool="mongodb"} 5
# HELP mongodb_pool_connections_in_use Connections currently checked out (in use) from the pool.
# TYPE mongodb_pool_connections_in_use gauge
mongodb_pool_connections_in_use{pool="mongodb"} 2
# HELP mongodb_connection_ready_state Mongoose connection readyState (0=disconnected,1=connected,2=connecting,3=disconnecting).
# TYPE mongodb_connection_ready_state gauge
mongodb_connection_ready_state{pool="mongodb",state="connected"} 1
```

## Prometheus scrape configuration

If `METRICS_TOKEN` is set, protect the endpoint the same way as `/metrics`
by sending `Authorization: Bearer <token>` (see `authorization` below).

```yaml
# prometheus.yml
scrape_configs:
  - job_name: dnb-backend-db-pool
    metrics_path: /metrics/database
    scheme: http
    static_configs:
      - targets: ["dnb-backend:5000"]
        labels:
          service: dnb-backend
    # Uncomment if METRICS_TOKEN is configured:
    # authorization:
    #   type: Bearer
    #   credentials: "<METRICS_TOKEN>"
```

## Grafana

### Panel: pool saturation (time series)

```json
{
  "title": "MongoDB Pool Saturation",
  "type": "timeseries",
  "targets": [
    { "expr": "mongodb_pool_connections_in_use{service=\"dnb-backend\"}", "legendFormat": "in use" },
    { "expr": "mongodb_pool_connections_available{service=\"dnb-backend\"}", "legendFormat": "available" },
    { "expr": "mongodb_pool_max_size{service=\"dnb-backend\"}", "legendFormat": "max" }
  ],
  "fieldConfig": { "defaults": { "unit": "short", "min": 0 } }
}
```

### Panel: checkout wait queue (stat)

```json
{
  "title": "DB Pool Wait Queue",
  "type": "stat",
  "targets": [
    { "expr": "mongodb_pool_wait_queue_size{service=\"dnb-backend\"}", "legendFormat": "pending" }
  ],
  "options": { "colorMode": "value" },
  "fieldConfig": {
    "defaults": {
      "thresholds": { "steps": [
        { "color": "green", "value": null },
        { "color": "orange", "value": 1 },
        { "color": "red", "value": 5 }
      ] }
    }
  }
}
```

### Panel: connection error rate (time series)

```json
{
  "title": "DB Pool Errors (rate)",
  "type": "timeseries",
  "targets": [
    { "expr": "rate(mongodb_pool_errors_total{service=\"dnb-backend\"}[5m])", "legendFormat": "errors/s" },
    { "expr": "rate(mongodb_pool_checkout_failures_total{service=\"dnb-backend\"}[5m])", "legendFormat": "checkout failures/s" }
  ],
  "fieldConfig": { "defaults": { "unit": "ops", "min": 0 } }
}
```

### Suggested alerts

```yaml
groups:
  - name: dnb-backend-db-pool
    rules:
      - alert: MongoPoolSaturated
        expr: mongodb_pool_connections_in_use / mongodb_pool_max_size > 0.9
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "MongoDB pool >90% utilised"
      - alert: MongoPoolWaitQueueBacklog
        expr: mongodb_pool_wait_queue_size > 0
        for: 2m
        labels: { severity: warning }
        annotations:
          summary: "Requests are waiting for a DB connection"
      - alert: MongoDisconnected
        expr: mongodb_connection_ready_state != 1
        for: 1m
        labels: { severity: critical }
        annotations:
          summary: "Mongoose connection is not in the connected state"
```
