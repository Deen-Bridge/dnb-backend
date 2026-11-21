// Shared by the ingestion worker and the reconciliation status endpoint so
// both agree on which accounts must be polled and how often (#696).

/**
 * Bounded classification of the last thing that went wrong for an account.
 * The raw error text goes to the logs; only these codes are persisted on the
 * cursor and reported by the status endpoint.
 */
export const INGESTION_ERROR_CODES = Object.freeze({
  HORIZON_RATE_LIMITED: "horizon_rate_limited",
  HORIZON_UNAVAILABLE: "horizon_unavailable",
  HORIZON_ERROR: "horizon_error",
  RECONCILE_FAILED: "reconcile_failed",
  PERSISTENCE_ERROR: "persistence_error",
});

const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;
// The lease is renewed once per account per loop, and a loop over a full
// page (200 payments, each with a parent-transaction fetch) can take several
// poll intervals. Four intervals, and never under two minutes, keeps a busy
// worker from looking dead while still catching one that stopped.
const LEASE_POLL_MULTIPLIER = 4;
const MIN_LEASE_MS = 2 * 60 * 1000;

/**
 * Accounts the worker is expected to poll, with a stable role label. The same
 * key configured for both roles is polled (and reported) once, as platform.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Array<{ account: string, role: "platform"|"donation" }>}
 */
export const listWatchedAccounts = (env = process.env) => {
  const watched = [];
  const add = (account, role) => {
    if (typeof account !== "string" || account.trim() === "") return;
    const normalized = account.trim();
    if (!watched.some((entry) => entry.account === normalized)) {
      watched.push({ account: normalized, role });
    }
  };

  add(env.PLATFORM_WALLET_PUBLIC_KEY, "platform");
  add(env.DONATION_WALLET_PUBLIC_KEY, "donation");
  return watched;
};

export const resolvePollIntervalMs = (env = process.env) => {
  const configured = Number(env.INGESTION_POLL_INTERVAL_MS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_POLL_INTERVAL_MS;
};

export const resolveLeaseMs = (env = process.env) =>
  Math.max(resolvePollIntervalMs(env) * LEASE_POLL_MULTIPLIER, MIN_LEASE_MS);
