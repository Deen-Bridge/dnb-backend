import express from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import poolMetrics from "../../../mongo/monitoring/poolMetrics.js";

const router = express.Router();

/**
 * GET /metrics/database
 * ---------------------------------------------------------------------------
 * Exposes MongoDB connection-pool statistics in Prometheus text exposition
 * format (v0.0.4). The collector is normally wired up at boot in
 * `src/config/db.js`; as a safety net this handler lazily attaches the
 * listeners if a live connection exists but has not yet been instrumented
 * (e.g. when the process connected after this route was first imported).
 *
 * The endpoint never fails on a missing/partial connection — it returns valid
 * zeroed metrics so a Prometheus scrape always succeeds.
 */
router.get("/", (req, res) => {
  try {
    const expected = process.env.METRICS_DATABASE_TOKEN;
    const supplied = req.get("authorization")?.startsWith("Bearer ")
      ? req.get("authorization").slice(7)
      : "";
    if (!expected) return res.status(503).json({ success: false, message: "Database metrics are not configured" });
    const matches = supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!matches) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (
      !poolMetrics.isAttached() &&
      mongoose.connection &&
      mongoose.connection.readyState !== 0
    ) {
      poolMetrics.attach(mongoose.connection);
    }
  } catch {
    return res.status(503).json({ success: false, message: "Database metrics are unavailable" });
  }

  if (!poolMetrics.isAttached()) {
    return res.status(503).json({ success: false, message: "Database metrics are unavailable" });
  }

  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(poolMetrics.render());
});

export default router;
