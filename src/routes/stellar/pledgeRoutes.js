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

import { validate } from "../../middlewares/validate.js";
import {
  createPledgeValidation,
  listPledgeCyclesValidation,
  listPledgesValidation,
  updatePledgeStatusValidation,
  pledgeCycleParamValidation,
  pledgeCycleSubmitValidation,
} from "../../validators/paymentValidators.js";

const router = express.Router();
router.use(protect);
router.get("/", listPledgesValidation, validate, listPledges);
router.get("/stats", getPledgeStats);
router.post("/", createPledgeValidation, validate, idempotency(), createPledge);
router.patch("/:id/status", updatePledgeStatusValidation, validate, idempotency(), updatePledgeStatus);
router.get("/:id/cycles", listPledgeCyclesValidation, validate, listPledgeCycles);
router.post("/cycles/:cycleId/initialize", pledgeCycleParamValidation, validate, idempotency(), initializePledgeCycle);
router.post("/cycles/:cycleId/submit", pledgeCycleSubmitValidation, validate, idempotency(), submitPledgeCycle);
export default router;
