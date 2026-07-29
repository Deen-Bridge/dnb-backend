// routes/admin/auditRoutes.js
//
// Read-only admin API for querying audit logs.
// Mounted at: /api/admin/audit
//
// Gate: protect (JWT) → authorizeRoles("admin")
// No create / update / delete endpoints are exposed — ever.
import express from "express";
import mongoose from "mongoose";
import AuditLog from "../../models/AuditLog.js";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import { catchAsync, APIError } from "../../middlewares/errorHandler.js";

const router = express.Router();

// Apply auth gate to every route in this file
router.use(protect, authorizeRoles("admin"));

/**
 * GET /api/admin/audit
 *
 * Query params (all optional):
 *  actor       — MongoDB ObjectId string
 *  action      — exact action string (e.g. "auth.login.failure")
 *  targetType  — e.g. "User", "Transaction", "Wallet"
 *  targetId    — arbitrary string
 *  status      — "success" | "failure"
 *  from        — ISO date string (inclusive lower bound on createdAt)
 *  to          — ISO date string (inclusive upper bound on createdAt)
 *  page        — positive integer (default 1)
 *  limit       — positive integer (default 20, max 100)
 */
router.get(
  "/",
  catchAsync(async (req, res) => {
    const {
      actor,
      action,
      targetType,
      targetId,
      status,
      from,
      to,
      page  = "1",
      limit = "20",
    } = req.query;

    // ── Build filter ──────────────────────────────────────────────────────
    const filter = {};

    if (actor) {
      if (!mongoose.Types.ObjectId.isValid(actor)) {
        throw new APIError("Invalid actor ObjectId", 400);
      }
      filter.actor = new mongoose.Types.ObjectId(actor);
    }

    if (action) {
      filter.action = action;
    }

    if (targetType) {
      filter.targetType = targetType;
    }

    if (targetId) {
      filter.targetId = targetId;
    }

    if (status) {
      if (!["success", "failure"].includes(status)) {
        throw new APIError("status must be 'success' or 'failure'", 400);
      }
      filter.status = status;
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) {
        const fromDate = new Date(from);
        if (isNaN(fromDate.getTime())) throw new APIError("Invalid 'from' date", 400);
        filter.createdAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (isNaN(toDate.getTime())) throw new APIError("Invalid 'to' date", 400);
        filter.createdAt.$lte = toDate;
      }
    }

    // ── Pagination ────────────────────────────────────────────────────────
    const pageNum  = Math.max(1, parseInt(page,  10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip     = (pageNum - 1) * limitNum;

    // ── Query ─────────────────────────────────────────────────────────────
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("actor", "name email role")
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      logs,
      pagination: {
        page:   pageNum,
        limit:  limitNum,
        total,
        pages:  Math.ceil(total / limitNum),
      },
    });
  })
);

// Catch-all: any non-GET method on any path under this router returns 405.
// Belt-and-suspenders on top of the model-layer append-only pre-hooks.
router.use((req, res) =>
  res.status(405).json({ success: false, message: "Method not allowed on audit log" })
);

export default router;
