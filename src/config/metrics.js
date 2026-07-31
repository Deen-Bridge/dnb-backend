import promClient from "prom-client";
import logger from "./logger.js";

const registry = new promClient.Registry();

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

function observeHttpDuration(method, route, statusCode, durationMs) {
  httpRequestDuration.observe(
    { method, route: route || "unknown", status_code: String(statusCode) },
    durationMs / 1000
  );
}

function observeHorizonDuration(operation, outcome, durationMs) {
  horizonRequestDuration.observe(
    { operation, outcome },
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
  observeHttpDuration,
  observeHorizonDuration,
  metricsMiddleware,
};
