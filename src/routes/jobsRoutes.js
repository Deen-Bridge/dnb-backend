import express from "express";
import Job from "../models/Job.js";

const router = express.Router();
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

router.use((req, res, next) => {
  const token = process.env.JOBS_DASHBOARD_TOKEN;
  if (!token) return res.status(404).json({ success: false, message: "Not found" });
  if (req.headers.authorization !== `Bearer ${token}`) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
});

router.get("/", async (req, res) => {
  const jobs = await Job.find().sort({ createdAt: -1 }).limit(100).lean();
  if (req.accepts(["html", "json"]) === "html") {
    const rows = jobs
      .map((job) => `<tr><td>${escapeHtml(job.name)}</td><td>${escapeHtml(job.status)}</td><td>${job.attemptsMade}/${job.maxAttempts}</td><td>${escapeHtml(job.lastError || "")}</td></tr>`)
      .join("");
    return res.type("html").send(`<h1>DeenBridge Jobs</h1><table><tr><th>Name</th><th>Status</th><th>Attempts</th><th>Error</th></tr>${rows}</table>`);
  }
  res.json({ success: true, jobs });
});

router.get("/dead", async (req, res) => {
  const jobs = await Job.find({ status: "dead" }).sort({ failedAt: -1 }).lean();
  res.json({ success: true, jobs });
});

export default router;
