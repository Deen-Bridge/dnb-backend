# Webhook worker operations

The delivery worker is deployed as one or more stateless application workers.
MongoDB is the source of truth: an atomic claim changes a due delivery to
retrying and advances nextAttemptAt by the 30-second claim lock. If a worker
dies, the next poll reclaims the row after the lock expires.

Operators own the webhook queue. Alert on worker liveness (startedAt and
recent completion), claim age above 30 seconds, retry volume, dead-letter
depth, and disabled endpoints. The on-call owner is the backend platform
rotation; severity is warning for retries and critical for dead-letter growth
or an inactive endpoint with pending deliveries. Escalate critical alerts to
the backend lead and integration owner.

Replay is an authenticated, endpoint-owner/admin action. Every replay is
written to the webhook audit log and retains the original event ID, so the
signed delivery remains idempotent for consumers. Re-enable an endpoint only
after correcting its target, then monitor retries and dead letters. Never
replay a delivered event.

The worker exposes bounded status counters through getDeliveryWorkerStatus.
Failure-injection drills should stop a worker during a claim, wait for lock
expiry, confirm one recovery delivery, then replay a dead event and verify
that the consumer event-ID deduplication prevents duplicate business effects.
