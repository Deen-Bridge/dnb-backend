import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import { idempotency } from "../../middlewares/idempotency.js";
import {
  createPledge,
  getPledgeStats,
  initializePledgeCycle,
  listPledgeCycles,
  listPledges,
  submitPledgeCycle,
  updatePledgeStatus,
} from "../../controllers/stellar/pledgeController.js";

const router = express.Router();
router.use(protect);
router.get("/", listPledges);
router.get("/stats", getPledgeStats);
router.post("/", idempotency(), createPledge);
router.patch("/:id/status", updatePledgeStatus);
router.get("/:id/cycles", listPledgeCycles);
router.post("/cycles/:cycleId/initialize", idempotency(), initializePledgeCycle);
router.post("/cycles/:cycleId/submit", idempotency(), submitPledgeCycle);
export default router;
