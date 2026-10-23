// Admin API for progressive IP blocks (issue #128).
// Mounted at: /api/admin/blocked-ips
// Gate: protect (JWT) → authorizeRoles("admin")
import express from "express";
import net from "net";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import { catchAsync, APIError } from "../../middlewares/errorHandler.js";
import { listBlocked, unblock } from "../../services/fail2ban.service.js";

const router = express.Router();
router.use(protect, authorizeRoles("admin"));

router.get(
  "/",
  catchAsync(async (req, res) => {
    let data;
    try {
      data = await listBlocked();
    } catch {
      throw new APIError("Block store unavailable", 503);
    }
    res.status(200).json({ success: true, status: "success", data });
  })
);

router.delete(
  "/:ip",
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
    res.status(200).json({ success: true, status: "success", message: "IP unblocked" });
  })
);

export default router;
