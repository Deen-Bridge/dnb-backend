# Backup and disaster recovery contract

This document is the operational contract for restoring DeenBridge. Backups are
not considered usable until an isolated restore drill verifies the manifest,
checksums, application invariants, and recovery time.

## Recovery objectives

| Data class | Authority and recovery target | RPO | RTO |
| --- | --- | ---: | ---: |
| Payments, ledger, reconciliation, and audit logs | MongoDB is authoritative; reconcile against Stellar after restore | 15 min | 60 min |
| Users, learning, moderation, and entitlements | MongoDB is authoritative | 60 min | 120 min |
| Outbound webhook deliveries and durable jobs | MongoDB is authoritative; replay pending work after restore | 15 min | 60 min |
| Required Redis state | Redis is reconstructable except explicitly documented coordination keys | 15 min | 30 min |
| Uploaded media and object metadata | Object storage is authoritative; MongoDB references must remain resolvable | 60 min | 180 min |
| Configuration and secrets metadata | Encrypted configuration backup; secret values are recovered through the KMS/key owner | 24 h | 120 min |

RPO is the maximum accepted data age. RTO is measured from restore approval to
the service passing readiness and invariant checks. A drill must record actual
values and fail if either objective is exceeded.

## Backup scope and controls

Every backup set must contain encrypted artifacts for `mongodb`, `redis`,
`object-storage`, `queues`, `configuration`, and `audit-evidence`. Redis cache
keys are not authoritative and may be rebuilt, but durable locks, idempotency
records, rate-limit state, and other required coordination data must be called
out explicitly in the Redis artifact.

Backups must use provider-side encryption plus application-managed key
encryption where supported. The key reference, KMS ownership, rotation policy,
and break-glass recovery owner belong in the manifest; key material and secret
values must never be written to this repository or to drill logs. Retain at
least 35 daily, 12 weekly, and 12 monthly versions, with access limited to the
backup operator and the recovery operator. Delete or quarantine failed,
partial, and unverified backup sets.

## Manifest and verification

The backup pipeline produces a JSON manifest beside the artifacts. It includes
the backup ID, creation time, RPO/RTO, encryption key reference, retention
policy, component names, relative artifact paths, and SHA-256 checksums. Verify
it before any restore:

```bash
node scripts/verify-recovery-manifest.cjs /secure/drill/manifest.json
```

The verifier rejects missing components, unencrypted manifests, path traversal,
missing artifacts, and checksum mismatches. It is intentionally independent of
MongoDB, Redis, and cloud SDKs so it can run in a clean recovery environment.

## Isolated restore drill

Run at least monthly and after a backup, schema, queue, object-storage, or key
management change. The recovery operator uses a separate account, network,
database, Redis namespace, and object-storage prefix; production credentials
and customer traffic are never used.

1. Select the newest backup that meets the data-class RPOs and record its ID.
2. Verify the manifest and every checksum with the script above.
3. Restore MongoDB, Redis coordination state, queue records, configuration
   metadata, and object storage into the isolated environment.
4. Start the application in recovery mode and verify readiness, migrations,
   indexes, and collection counts.
5. Check invariants: ledger entries balance, payout totals reconcile,
   transaction hashes remain unique, webhook/job states are valid, audit rows
   are append-only, and referenced media objects exist.
6. Replay a quarantined sample of payments, webhooks, jobs, and notifications;
   verify idempotency and that no external payment or notification is emitted.
7. Record restore start/end times, row/object counts, checksum results,
   invariant results, operator approvals, and actual RPO/RTO.
8. Destroy the isolated data according to the retention policy and open a
   remediation item for every failed check.

The drill output is audit evidence. It must be retained with the backup ID and
never include credentials, raw webhook secrets, customer payloads, or payment
private keys.

## Monitoring, replay, and rollback

Alert when a scheduled backup is stale, fails, is smaller than the previous
expected range, cannot be checksum-verified, or has not passed a restore drill
within the required interval. Alerts route to the backup operator and the
incident owner with the backup ID, component, and failure class only.

After recovery, replay only quarantined payments and webhook/job records. Use
transaction hashes, idempotency keys, and delivery IDs to deduplicate; reconcile
financial records against Stellar before releasing payouts. Keep outbound
notifications disabled until reconciliation is approved.

If invariant checks fail, stop traffic, preserve the isolated evidence, and
roll back to the last verified backup. The incident owner decides whether to
retry, promote a previous restore point, or enter manual reconciliation. The
backup operator owns backup health and key access; the recovery operator owns
the drill; the finance/privacy owners approve payment and sensitive-data
reconciliation.

## Query for new recovery-sensitive changes

Reviews that add a data store, queue, payment state, webhook, secret, or
uploaded object must answer: Is it authoritative or reconstructable? What are
its RPO/RTO, encryption and retention controls, restore invariant, replay and
deduplication key, alert, owner, and rollback plan? The change is incomplete
until the backup manifest and isolated drill include it.
