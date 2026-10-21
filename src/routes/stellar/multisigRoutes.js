// routes/stellar/multisigRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import { idempotency } from "../../middlewares/idempotency.js";
import {
  addSigner,
  removeSigner,
  setThresholds,
  createPending,
  listPending,
  getPending,
  signPending,
  submitPending,
} from "../../controllers/stellar/multisigController.js";

const router = express.Router();

// All multisig routes require authentication.
router.use(protect);

// Build unsigned setOptions XDR (clients sign it; no secret keys are accepted)
router.post("/signers/add", idempotency(), addSigner);
router.post("/signers/remove", idempotency(), removeSigner);
router.post("/thresholds", idempotency(), setThresholds);

// Pending multi-sig transactions
router.post("/transactions", idempotency(), createPending);
router.get("/transactions", listPending);
router.get("/transactions/:id", getPending);
router.post("/transactions/:id/sign", idempotency(), signPending);
router.post("/transactions/:id/submit", idempotency(), submitPending);

export default router;
