import promClient from "prom-client";
import logger from "./logger.js";

const registry = new promClient.Registry();
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const ALLOWED_OUTCOMES = new Set(["success", "error", "timeout", "rate_limited"]);
const ALLOWED_REASONS = new Set(["validation_failed", "stellar_error", "verification_failed", "provider_error", "timeout", "rate_limited", "other"]);
const boundedLabel = (value, allowed, fallback = "other") => {
  const normalized = String(value || "").toLowerCase().slice(0, 64);
  return allowed.has(normalized) ? normalized : fallback;
};
const safeRoute = (route) => String(route || "unknown").split("/").map((part) => {
  if (!part) return "";
  return /^[a-f0-9]{16,}$/i.test(part) || /^\d+$/.test(part) ? ":id" : part.slice(0, 48);
}).join("/") || "unknown";

promClient.collectDefaultMetrics({ register: registry });

const httpRequestDuration = new promClient.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const horizonRequestDuration = new promClient.Histogram({
  name: "horizon_request_duration_seconds",
  help: "Stellar Horizon API call duration in seconds",
  labelNames: ["operation", "outcome"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const paymentsInitialized = new promClient.Counter({
  name: "payments_initialized_total",
  help: "Total number of payments initialized",
  labelNames: ["type"],
  registers: [registry],
});

const paymentsSubmitted = new promClient.Counter({
  name: "payments_submitted_total",
  help: "Total number of payment transactions submitted",
  labelNames: ["type"],
  registers: [registry],
});

const paymentsConfirmed = new promClient.Counter({
  name: "payments_confirmed_total",
  help: "Total number of confirmed payments",
  labelNames: ["type"],
  registers: [registry],
});

const paymentsFailed = new promClient.Counter({
  name: "payments_failed_total",
  help: "Total number of failed payments",
  labelNames: ["type", "reason"],
  registers: [registry],
});

// Fee-bump sponsorship (#30): one increment per sponsorship decision so the
// approve/reject ratio and rejection reasons are observable in Prometheus.
const sponsorshipsApproved = new promClient.Counter({
  name: "fee_sponsorships_approved_total",
  help: "Total number of transactions approved for platform fee sponsorship",
  labelNames: ["type"],
  registers: [registry],
});

const sponsorshipsRejected = new promClient.Counter({
  name: "fee_sponsorships_rejected_total",
  help: "Total number of sponsorship requests rejected before submission",
  labelNames: ["type", "reason"],
  registers: [registry],
});

// Payment reconciliation (#695). Labels are drawn from fixed sets so a hostile
// memo can never mint new series; wallet addresses and memos are never labels.
const RECONCILIATION_STRATEGIES = new Set(["tx_hash", "canonical", "legacy", "donation", "none"]);
const RECONCILIATION_OUTCOMES = new Set(["matched", "duplicate", "rejected", "ambiguous", "not_found", "error"]);
const RECONCILIATION_SCHEMES = new Set(["canonical", "legacy"]);
const RECONCILIATION_REASONS = new Set([
  "no_reference", "malformed_reference", "reference_not_found", "ambiguous_reference",
  "item_type_mismatch", "item_not_found", "reference_already_settled",
  "reference_hash_mismatch", "transaction_not_reconcilable", "network_mismatch",
  "asset_mismatch", "source_mismatch", "destination_mismatch", "amount_mismatch",
  "verification_failed",
  "verification_unavailable", "unknown_donor", "lookup_failed",
]);

const reconciliationLookupDuration = new promClient.Histogram({
  name: "payment_reconciliation_lookup_duration_seconds",
  help: "Time spent resolving an ingested payment to a checkout",
  labelNames: ["strategy", "outcome"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

const reconciliationAmbiguousReferences = new promClient.Counter({
  name: "payment_reconciliation_ambiguous_references_total",
  help: "Payment references that resolved to more than one checkout",
  labelNames: ["scheme"],
  registers: [registry],
});

const reconciliationRejectedReferences = new promClient.Counter({
  name: "payment_reconciliation_rejected_references_total",
  help: "Payment references rejected during reconciliation",
  labelNames: ["reason"],
  registers: [registry],
});

const reconciliationUnreconciledPayments = new promClient.Counter({
  name: "payment_reconciliation_unreconciled_total",
  help: "Payments persisted as unreconciled for manual review",
  labelNames: ["reason"],
  registers: [registry],
});

// Reconciliation health (#696). The ingestion worker may run in its own
// process, so cross-process signals come from the persisted status snapshot
// (see reconciliationHealthService) rather than from worker-local counters.
// Account labels are roles, never wallet addresses.
const HEALTH_STATES = ["healthy", "degraded", "stalled", "unknown"];
const CURSOR_STATES = ["fresh", "failing", "stale", "stalled", "missing"];
const ACCOUNT_ROLES = new Set(["platform", "donation"]);
const BACKLOG_BUCKETS = ["under1h", "from1hTo24h", "from24hTo7d", "over7d"];
const POLL_OUTCOMES = new Set(["success", "partial", "failed"]);
const HEALTH_REFRESH_TTL_MS = 15 * 1000;

let healthProvider = null;
let healthRefresh = null;
let healthRefreshedAt = 0;

const applyReconciliationHealth = (status) => {
  for (const state of HEALTH_STATES) {
    reconciliationHealthState.set({ state }, state === status.state ? 1 : 0);
  }

  // Reset per-account series so an account that disappears from config does
  // not leave a frozen value behind.
  ingestionCursorState.reset();
  ingestionCursorLag.reset();
  ingestionConsecutiveFailures.reset();
  for (const account of status.ingestion?.accounts ?? []) {
    if (!ACCOUNT_ROLES.has(account.role)) continue;
    for (const state of CURSOR_STATES) {
      ingestionCursorState.set({ role: account.role, state }, state === account.state ? 1 : 0);
    }
    if (account.secondsSinceLastSuccess !== null) {
      ingestionCursorLag.set({ role: account.role }, account.secondsSinceLastSuccess);
    }
    ingestionConsecutiveFailures.set({ role: account.role }, account.consecutiveFailures);
  }

  const backlog = status.backlog ?? {};
  for (const bucket of BACKLOG_BUCKETS) {
    reconciliationBacklog.set({ age_bucket: bucket }, backlog.byAge?.[bucket] ?? 0);
  }
  reconciliationBacklogOldestAge.set(backlog.oldestAgeSeconds ?? 0);
};

const markReconciliationHealthUnknown = () => {
  for (const state of HEALTH_STATES) {
    reconciliationHealthState.set({ state }, state === "unknown" ? 1 : 0);
  }
};

const runHealthRefresh = async (provider) => {
  try {
    const status = await provider();
    if (status) applyReconciliationHealth(status);
  } catch (err) {
    markReconciliationHealthUnknown();
    logger.warn({ err: err?.message }, "Failed to refresh reconciliation health metrics");
  } finally {
    healthRefreshedAt = Date.now();
  }
};

/**
 * Refresh the health gauges from the registered provider. Every gauge's
 * collect() awaits the same in-flight promise, so one scrape costs at most
 * one status computation, and results are reused for HEALTH_REFRESH_TTL_MS.
 */
const refreshReconciliationHealth = async () => {
  if (!healthProvider) return;
  if (healthRefresh) {
    await healthRefresh;
    return;
  }
  if (Date.now() - healthRefreshedAt < HEALTH_REFRESH_TTL_MS) return;

  const pending = runHealthRefresh(healthProvider);
  healthRefresh = pending;
  try {
    await pending;
  } finally {
    if (healthRefresh === pending) healthRefresh = null;
  }
};

const healthCollect = async () => {
  await refreshReconciliationHealth();
};

const reconciliationHealthState = new promClient.Gauge({
  name: "payment_reconciliation_health_state",
  help: "Overall reconciliation health; exactly one state is 1 (see docs/payment-reconciliation.md)",
  labelNames: ["state"],
  registers: [registry],
  collect: healthCollect,
});

const ingestionCursorState = new promClient.Gauge({
  name: "payment_ingestion_cursor_state",
  help: "Per-account ingestion cursor state; exactly one state per role is 1",
  labelNames: ["role", "state"],
  registers: [registry],
  collect: healthCollect,
});

const ingestionCursorLag = new promClient.Gauge({
  name: "payment_ingestion_cursor_lag_seconds",
  help: "Seconds since the ingestion worker last polled this account successfully",
  labelNames: ["role"],
  registers: [registry],
  collect: healthCollect,
});

const ingestionConsecutiveFailures = new promClient.Gauge({
  name: "payment_ingestion_consecutive_failures",
  help: "Consecutive failed Horizon polls for this account",
  labelNames: ["role"],
  registers: [registry],
  collect: healthCollect,
});

const reconciliationBacklog = new promClient.Gauge({
  name: "payment_reconciliation_backlog",
  help: "Open unreconciled payments by age since first seen",
  labelNames: ["age_bucket"],
  registers: [registry],
  collect: healthCollect,
});

const reconciliationBacklogOldestAge = new promClient.Gauge({
  name: "payment_reconciliation_backlog_oldest_age_seconds",
  help: "Age of the oldest open unreconciled payment (0 when the backlog is empty)",
  registers: [registry],
  collect: healthCollect,
});

// Only scraped when the worker runs inside the API process
// (INGESTION_WORKER_ENABLED=true); the persisted gauges above cover both modes.
const ingestionPolls = new promClient.Counter({
  name: "payment_ingestion_polls_total",
  help: "Ingestion worker polls by account role and outcome",
  labelNames: ["role", "outcome"],
  registers: [registry],
});

/**
 * Register the function that computes the reconciliation status snapshot.
 * Called once at API startup; until then the health gauges stay empty, which
 * keeps unit tests and tools that import the registry free of DB queries.
 *
 * @param {(() => Promise<object>)|null} provider
 */
function setReconciliationHealthProvider(provider) {
  healthProvider = typeof provider === "function" ? provider : null;
  healthRefresh = null;
  healthRefreshedAt = 0;
}

/** Push a freshly computed status into the gauges (e.g. from the endpoint). */
function recordReconciliationHealth(status) {
  applyReconciliationHealth(status);
  healthRefreshedAt = Date.now();
}

function recordIngestionPoll(role, outcome) {
  ingestionPolls.inc({
    role: ACCOUNT_ROLES.has(role) ? role : "other",
    outcome: POLL_OUTCOMES.has(outcome) ? outcome : "failed",
  });
}

function observeReconciliationLookup(strategy, outcome, durationMs) {
  reconciliationLookupDuration.observe(
    {
      strategy: boundedLabel(strategy, RECONCILIATION_STRATEGIES, "none"),
      outcome: boundedLabel(outcome, RECONCILIATION_OUTCOMES, "error"),
    },
    durationMs / 1000
  );
}

function recordAmbiguousReference(scheme) {
  reconciliationAmbiguousReferences.inc({ scheme: boundedLabel(scheme, RECONCILIATION_SCHEMES, "legacy") });
}

function recordRejectedReference(reason) {
  reconciliationRejectedReferences.inc({ reason: boundedLabel(reason, RECONCILIATION_REASONS) });
}

function recordUnreconciledPayment(reason) {
  reconciliationUnreconciledPayments.inc({ reason: boundedLabel(reason, RECONCILIATION_REASONS) });
}

function observeHttpDuration(method, route, statusCode, durationMs) {
  httpRequestDuration.observe(
    { method: ALLOWED_METHODS.has(method) ? method : "OTHER", route: safeRoute(route), status_code: ["2", "3", "4", "5"].includes(String(statusCode)[0]) ? String(statusCode)[0] + "xx" : "other" },
    durationMs / 1000
  );
}

function observeHorizonDuration(operation, outcome, durationMs) {
  horizonRequestDuration.observe(
    { operation: safeRoute(operation).replace(/[^a-z0-9_:/-]/gi, "_").slice(0, 64), outcome: boundedLabel(outcome, ALLOWED_OUTCOMES) },
    durationMs / 1000
  );
}

async function metricsMiddleware(req, res, next) {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const auth = req.headers.authorization || "";
    const expected = "Bearer " + token;
    if (auth !== expected) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
  }

  try {
    res.setHeader("Content-Type", registry.contentType);
    const metrics = await registry.metrics();
    res.end(metrics);
  } catch (err) {
    logger.error(err, "Failed to generate metrics");
    res.status(500).json({ success: false, message: "Metrics error" });
  }
}

export {
  registry,
  httpRequestDuration,
  horizonRequestDuration,
  paymentsInitialized,
  paymentsSubmitted,
  paymentsConfirmed,
  paymentsFailed,
  sponsorshipsApproved,
  sponsorshipsRejected,
  reconciliationLookupDuration,
  reconciliationAmbiguousReferences,
  reconciliationRejectedReferences,
  reconciliationUnreconciledPayments,
  reconciliationHealthState,
  ingestionCursorState,
  ingestionCursorLag,
  ingestionConsecutiveFailures,
  reconciliationBacklog,
  reconciliationBacklogOldestAge,
  ingestionPolls,
  setReconciliationHealthProvider,
  recordReconciliationHealth,
  refreshReconciliationHealth,
  recordIngestionPoll,
  observeHttpDuration,
  observeHorizonDuration,
  observeReconciliationLookup,
  recordAmbiguousReference,
  recordRejectedReference,
  recordUnreconciledPayment,
  metricsMiddleware,
};
