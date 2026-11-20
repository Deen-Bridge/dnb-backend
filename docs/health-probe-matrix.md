# Health probe matrix

The application exposes separate probe contracts so a recoverable dependency
outage removes a pod from service without restarting its process.

| Probe | Contract | Mongo/Redis required | Deployment use |
| --- | --- | --- | --- |
| `/health/live` | Process can accept HTTP requests; response is always `200 pong`. | Neither | Kubernetes liveness, Docker and Compose health checks |
| `/health/ready` | Critical traffic dependencies are available. | MongoDB and Redis | Kubernetes readiness and CI boot assertion |
| `/health/startup` | Startup dependency initialization has completed. | MongoDB; Redis may reconnect in the background | Kubernetes startup probe |
| `/health` | Backward-compatible alias for readiness. | MongoDB and Redis | Existing clients only; new probes use explicit paths |

Redis is required for routed traffic, but Redis loss is not a process-health or
startup failure once MongoDB is serving. The liveness probe therefore stays independent of MongoDB and Redis;
Kubernetes stops routing through readiness while the process remains available
to recover. Probe responses include the selected `data.probe` value and safe
dependency states for diagnosis.

## Failure-injection checks

The health controller tests inject disconnected MongoDB and unavailable Redis
states. They assert readiness returns `503` while the dependency-free liveness
handler remains `200`. A deployment verification should repeat those assertions
against a running pod by temporarily blocking Redis and confirming that
readiness fails without a liveness restart.
