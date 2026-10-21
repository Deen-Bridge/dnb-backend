// routes/security/cspReportRoutes.js
// Mounted at /api/security/csp-report (issue #140).
import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import { receiveCspReport, getCspStats } from "../../controllers/cspReportController.js";

const router = express.Router();

// Body parser scoped to this route only: browsers send these content types,
// which the global express.json() does not parse. Small limit; reports are tiny.
const cspBodyParser = express.json({
  type: ["application/csp-report", "application/reports+json", "application/json"],
  limit: "10kb",
});

// Unauthenticated by design (browsers send reports without credentials).
router.post("/", cspBodyParser, receiveCspReport);

// Malformed / oversized report bodies: still answer 204, never leak details.
router.use((err, req, res, next) => {
  if (req.method === "POST" && req.path === "/") return res.status(204).end();
  return next(err);
});

router.get("/stats", protect, authorizeRoles("admin"), getCspStats);

export default router;
