import CspViolation from "../models/CspViolation.js";
import logger from "../config/logger.js";

const MAX_STR = 512;
const MAX_REPORTS_PER_REQUEST = 10;

/** Coerce untrusted input to a bounded string without control characters. */
export const clean = (value, max = MAX_STR) => {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
};

/** Drop query string / fragment (may carry tokens) and cap length. */
const stripUrl = (value) => {
  const s = clean(value, 2048);
  if (!s) return "";
  return s.split("#")[0].split("?")[0].slice(0, MAX_STR);
};

const originOf = (url) => {
  try {
    return new URL(url).origin.slice(0, 200);
  } catch {
    return "";
  }
};

const toLine = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.floor(Math.min(v, 1e9)) : 0;
};

/**
 * Normalize both report formats:
 *  - legacy `application/csp-report`: { "csp-report": { "document-uri": ... } }
 *  - Reporting API `application/reports+json`: [{ type, body: { documentURL ... } }]
 * Returns an array of plain, length-capped report objects.
 */
export const normalizeReports = (body) => {
  const out = [];
  const push = (r) => {
    if (!r || typeof r !== "object") return;
    const violatedDirective = clean(
      r["violated-directive"] ?? r.violatedDirective ?? r["effective-directive"] ?? r.effectiveDirective,
      100,
    );
    if (!violatedDirective) return;
    const documentUri = stripUrl(r["document-uri"] ?? r.documentURL ?? r.documentUri);
    out.push({
      documentUri,
      documentOrigin: originOf(documentUri),
      violatedDirective,
      effectiveDirective: clean(r["effective-directive"] ?? r.effectiveDirective, 100),
      blockedUri: stripUrl(r["blocked-uri"] ?? r.blockedURL ?? r.blockedUri),
      sourceFile: stripUrl(r["source-file"] ?? r.sourceFile),
      lineNumber: toLine(r["line-number"] ?? r.lineNumber),
    });
  };

  if (Array.isArray(body)) {
    for (const item of body.slice(0, MAX_REPORTS_PER_REQUEST)) {
      if (item && typeof item === "object" && item.type === "csp-violation") push(item.body);
    }
  } else if (body && typeof body === "object") {
    push(body["csp-report"]);
  }
  return out;
};

/**
 * POST /api/security/csp-report
 * Always 204: browsers ignore the response and the endpoint is unauthenticated,
 * so we never reveal validation or storage failures. Raw bodies are never logged.
 */
export const receiveCspReport = async (req, res) => {
  try {
    const reports = normalizeReports(req.body);
    const userAgent = clean(req.get("user-agent") || "", 256);
    const ip = clean(req.ip || "", 64);
    const now = new Date();

    await Promise.all(
      reports.map((r) =>
        CspViolation.findOneAndUpdate(
          {
            violatedDirective: r.violatedDirective,
            blockedUri: r.blockedUri,
            documentOrigin: r.documentOrigin,
          },
          {
            $inc: { count: 1 },
            $set: {
              lastSeen: now,
              documentUri: r.documentUri,
              effectiveDirective: r.effectiveDirective,
              sourceFile: r.sourceFile,
              lineNumber: r.lineNumber,
              userAgent,
              ip,
            },
            $setOnInsert: { firstSeen: now },
          },
          { upsert: true },
        ),
      ),
    );
    if (reports.length) {
      logger.warn(
        `CSP violation: ${reports[0].violatedDirective} blocked=${reports[0].blockedUri} ip=${ip} ua=${userAgent}`,
      );
    }
  } catch (err) {
    logger.error(`CSP report handling failed: ${err.message}`);
  }
  return res.status(204).end();
};

/**
 * GET /api/security/csp-report/stats?days=7&limit=10 (admin only)
 */
export const getCspStats = async (req, res, next) => {
  try {
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const match = { $match: { lastSeen: { $gte: since } } };
    const top = (field) => [
      match,
      { $group: { _id: `$${field}`, count: { $sum: "$count" } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ];

    const [directives, blockedUris, totals] = await Promise.all([
      CspViolation.aggregate(top("violatedDirective")),
      CspViolation.aggregate(top("blockedUri")),
      CspViolation.aggregate([
        match,
        { $group: { _id: null, total: { $sum: "$count" }, distinct: { $sum: 1 } } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      data: {
        windowDays: days,
        totalViolations: totals[0]?.total || 0,
        distinctPatterns: totals[0]?.distinct || 0,
        topDirectives: directives.map((d) => ({ directive: d._id, count: d.count })),
        topBlockedUris: blockedUris.map((d) => ({ blockedUri: d._id, count: d.count })),
      },
    });
  } catch (err) {
    next(err);
  }
};
