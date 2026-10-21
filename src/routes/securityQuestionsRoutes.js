import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { authLimiter } from "../middlewares/security.js";
import { validate } from "../middlewares/validate.js";
import {
  listSecurityQuestions,
  setupSecurityQuestions,
  startQuestionRecovery,
  verifyQuestionRecovery,
} from "../controllers/securityQuestionsController.js";
import {
  setupSecurityQuestionsValidation,
  recoverStartValidation,
  recoverVerifyValidation,
} from "../validators/securityQuestionValidators.js";

// Mounted at /api/auth. authLimiter is applied per route (not router-wide) so
// requests for other /api/auth paths are not counted twice.
const router = express.Router();

router.get("/security-questions/list", listSecurityQuestions);
router.post(
  "/security-questions",
  authLimiter,
  protect,
  setupSecurityQuestionsValidation,
  validate,
  setupSecurityQuestions
);
router.post("/recover/questions/start", authLimiter, recoverStartValidation, validate, startQuestionRecovery);
router.post("/recover/questions/verify", authLimiter, recoverVerifyValidation, validate, verifyQuestionRecovery);

export default router;
