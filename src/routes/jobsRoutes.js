import express from "express";
import crypto from "crypto";
import Job from "../models/Job.js";

const router = express.Router();

/** Bounds for the operator views (issue #708). */
export const JOB_DASHBOARD_LIMITS = Object.freeze({
  defaultPageSize: 20,
  maxPageSize: 50,
  maxErrorLength: 200,
});

// Constant-time bearer-token comparison. timingSafeEqual throws on unequal
// lengths, so guard first — a length mismatch is simply a non-match and must
// not short-circuit through a timing side channel.
const safeTokenEqual = (a, b) => {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

/**
 * Error text comes from arbitrary providers and workers, so it can carry
 * request bodies, identifiers or credentials. Operators need the shape of the
 * failure, not the whole payload: collapse whitespace and truncate.
 */
export const redactJobError = (value) => {
  if (!value) return "";
  const collapsed = String(value).replace(/\s+/g, " ").trim();
  return collapsed.length > JOB_DASHBOARD_LIMITS.maxErrorLength
    ? `${collapsed.slice(0, JOB_DASHBOARD_LIMITS.maxErrorLength)}…`
    : collapsed;
};

/**
 * Minimal operational DTO. `payload` and `idempotencyKey` are never exposed:
 * both can contain user identifiers, provider references or secrets.
 */
export const toJobDto = (job) => ({
  id: job._id ? String(job._id) : undefined,
  name: job.name,
  status: job.status,
  attemptsMade: job.attemptsMade,
  maxAttempts: job.maxAttempts,
  runAt: job.runAt,
  lockedAt: job.lockedAt,
  createdAt: job.createdAt,
  completedAt: job.completedAt,
  failedAt: job.failedAt,
  lastError: redactJobError(job.lastError),
});

const JOB_PROJECTION = [
  "name",
  "status",
  "attemptsMade",
  "maxAttempts",
  "runAt",
  "lockedAt",
  "createdAt",
  "completedAt",
  "failedAt",
  "lastError",
].join(" ");

const parsePageParam = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Page size is clamped rather than rejected: an operator dashboard is not an
 * API where a wrong number should fail the request, but it must never be able
 * to pull the whole collection in one call.
 */
export const resolvePage = (query = {}) => {
  const requested = parsePageParam(query.limit, JOB_DASHBOARD_LIMITS.defaultPageSize);
  const limit = Math.min(requested, JOB_DASHBOARD_LIMITS.maxPageSize);
  const page = parsePageParam(query.page, 1);
  return { page, limit, skip: (page - 1) * limit };
};

// `_id` is appended to every sort so paging is stable when many rows share a
// timestamp — a tie-only sort key lets skip/limit repeat or drop rows.
const fetchPage = async (filter, sort, query) => {
  const { page, limit, skip } = resolvePage(query);
  // One extra row tells us whether another page exists without a second query.
  const rows = await Job.find(filter)
    .select(JOB_PROJECTION)
    .sort(sort)
    .skip(skip)
    .limit(limit + 1)
    .lean();

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    jobs: pageRows.map(toJobDto),
    pagination: {
      page,
      limit,
      returned: pageRows.length,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
    },
  };
};

router.use((req, res, next) => {
  const token = process.env.JOBS_DASHBOARD_TOKEN;
  if (!token) return res.status(404).json({ success: false, message: "Not found" });
  const provided = req.headers.authorization || "";
  if (!safeTokenEqual(provided, `Bearer ${token}`)) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
});

router.get("/", async (req, res) => {
  const { jobs, pagination } = await fetchPage({}, { createdAt: -1, _id: -1 }, req.query);
  // Prefer JSON unless the caller explicitly prefers HTML: a browser sends
  // `text/html`, while curl/scripts send `*/*` and should get the machine
  // readable shape (the same one `/dead` returns).
  if (req.accepts(["json", "html"]) === "html") {
    const rows = jobs
      .map(
        (job) =>
          `<tr><td>${escapeHtml(job.name)}</td><td>${escapeHtml(job.status)}</td><td>${job.attemptsMade}/${job.maxAttempts}</td><td>${escapeHtml(job.lastError)}</td></tr>`
      )
      .join("");
    return res
      .type("html")
      .send(
        `<h1>DeenBridge Jobs</h1><table><tr><th>Name</th><th>Status</th><th>Attempts</th><th>Error</th></tr>${rows}</table><p>Page ${pagination.page}, ${pagination.returned} rows${pagination.hasMore ? `, more available` : ""}</p>`
      );
  }
  res.json({ success: true, jobs, pagination });
});

router.get("/dead", async (req, res) => {
  const { jobs, pagination } = await fetchPage({ status: "dead" }, { failedAt: -1, _id: -1 }, req.query);
  res.json({ success: true, jobs, pagination });
});

export default router;
