// Admin API for progressive IP blocks (issue #128).
// Mounted at: /api/admin/blocked-ips
// Gate: protect (JWT) → authorizeRoles("admin")
import express from "express";
import net from "net";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import { catchAsync, APIError } from "../../middlewares/errorHandler.js";
import { listBlocked, unblock, blockIp } from "../../services/fail2ban.service.js";
import { standardLimiter } from "../../middlewares/security.js";
import { recordAudit } from "../../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../../models/AuditLog.js";

const router = express.Router();
router.use(protect, authorizeRoles("admin"));

router.get(
  "/",
  catchAsync(async (req, res) => {
    let data;
    try {
      data = await listBlocked({ search: req.query.search, limit: req.query.limit });
    } catch {
      throw new APIError("Block store unavailable", 503);
    }
    res.status(200).json({ success: true, status: "success", data });
  })
);

router.post(
  "/",
  standardLimiter,
  catchAsync(async (req, res) => {
    const { ip, reason, scope, expiresInSec } = req.body || {};
    if (!net.isIP(ip) || typeof reason !== "string" || reason.trim().length < 3) {
      throw new APIError("A valid IP and reason are required", 400);
    }
    let block;
    try { block = await blockIp({ ip, reason: reason.trim(), scope, expiresInSec, actorId: req.user._id }); }
    catch (error) { throw new APIError(error.message, error.message.includes("already") ? 409 : 503); }
    recordAudit({ action: AUDIT_ACTIONS.SECURITY_IP_BLOCK, actor: req.user._id, req, targetType: "IP", targetId: ip, status: "success", metadata: { reason, scope, expiresInSec, source: "manual" } });
    res.status(201).json({ success: true, status: "success", data: block });
  })
);

router.delete(
  "/:ip",
  standardLimiter,
  catchAsync(async (req, res) => {
    const ip = req.params.ip;
    if (!net.isIP(ip)) throw new APIError("Invalid IP address", 400);
    let removed;
    try {
      removed = await unblock(ip);
    } catch {
      throw new APIError("Block store unavailable", 503);
    }
    if (!removed) throw new APIError("IP is not blocked", 404);
    recordAudit({ action: AUDIT_ACTIONS.SECURITY_IP_UNBLOCK, actor: req.user._id, req, targetType: "IP", targetId: ip, status: "success", metadata: { reason: "operator-recovery" } });
    res.status(200).json({ success: true, status: "success", message: "IP unblocked" });
  })
);

export default router;
