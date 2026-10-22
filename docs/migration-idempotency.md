# Migration idempotency

Every schema migration must be safe to retry after a failed deploy. Use `CREATE ... IF NOT EXISTS`, guarded `ALTER TABLE` checks, and a migration ledger keyed by filename. Never assume a partially applied migration can be rolled back automatically; the runner records completion only after the statement batch succeeds.
