import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  createPledge,
  pausePledge,
  resumePledge,
  cancelPledge,
  listPledges,
  getPledgeStats,
  initializePledgeCycle,
  submitPledgeCycle,
} from "../../controllers/stellar/pledgeController.js";

const router = express.Router();

router.get("/me/stats", protect, getPledgeStats);
router.get("/me", protect, listPledges);
router.post("/", protect, createPledge);
router.post("/:pledgeId/pause", protect, pausePledge);
router.post("/:pledgeId/resume", protect, resumePledge);
router.post("/:pledgeId/cancel", protect, cancelPledge);
router.post("/:pledgeId/cycles/:cycleId/initialize", protect, initializePledgeCycle);
router.post("/:pledgeId/cycles/:cycleId/submit", protect, submitPledgeCycle);

export default router;
