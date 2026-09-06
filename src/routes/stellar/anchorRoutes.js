// routes/stellar/anchorRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  getInfo,
  requestChallenge,
  verifyChallenge,
  initiateDeposit,
  initiateWithdrawal,
  getTransactions,
  getTransactionById,
} from "../../controllers/stellar/anchorController.js";

const router = express.Router();

router.get("/info", protect, getInfo);
router.post("/auth/challenge", protect, requestChallenge);
router.post("/auth/verify", protect, verifyChallenge);
router.post("/deposits", protect, initiateDeposit);
router.post("/withdrawals", protect, initiateWithdrawal);
router.get("/transactions", protect, getTransactions);
router.get("/transactions/:id", protect, getTransactionById);

export default router;
