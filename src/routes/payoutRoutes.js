// routes/payoutRoutes.js
import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  buildBatch,
  submitBatch,
  getMyBalance,
  getMyStatement,
  getMyHistory,
} from "../controllers/payoutController.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Educator endpoints
router.get("/me/balance", getMyBalance);
router.get("/me/statement", getMyStatement);
router.get("/me/history", getMyHistory);

// Operator endpoints (gated by PAYOUT_ADMIN_USER_IDS allowlist in controller)
router.post("/build", buildBatch);
router.post("/:batchId/submit", submitBatch);

export default router;
