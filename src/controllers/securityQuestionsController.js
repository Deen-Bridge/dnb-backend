import bcrypt from "bcryptjs";
import User from "../models/User.js";
import SecurityQuestions from "../models/SecurityQuestions.js";
import logger from "../config/logger.js";
import { catchAsync, APIError } from "../middlewares/errorHandler.js";
import { generateOtp, hashOtp } from "../utils/otp.js";
import { recordAudit } from "../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { SECURITY_QUESTIONS } from "../constants/securityQuestions.js";
import {
  normalizeAnswer,
  hashAnswer,
  fakeQuestionIds,
  getDummyHash,
} from "../utils/securityQuestions.js";

const GENERIC_FAIL = "Unable to verify security answers";

export const listSecurityQuestions = (req, res) =>
  res.status(200).json({ success: true, data: { questions: SECURITY_QUESTIONS } });

// POST /api/auth/security-questions (authenticated; re-checks current password)
export const setupSecurityQuestions = catchAsync(async (req, res, next) => {
  const { currentPassword, answers } = req.body;

  const user = await User.findById(req.user._id).select("+password");
  if (!user || !user.password) return next(new APIError("User not found", 404));

  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return next(new APIError("Current password is incorrect", 401));
  }

  const questions = [];
  for (const { questionId, answer } of answers) {
    questions.push({ questionId, answerHash: await hashAnswer(answer) });
  }

  await SecurityQuestions.findOneAndUpdate(
    { user: user._id },
    { user: user._id, questions },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  recordAudit({
    action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
    actor: user._id,
    req,
    targetType: "User",
    targetId: user._id.toString(),
    status: "success",
    metadata: { event: "security_questions_set" },
  });

  res.status(200).json({ success: true, message: "Security questions saved" });
});

// POST /api/auth/recover/questions/start
export const startQuestionRecovery = catchAsync(async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const user = await User.findOne({ email });
  const record = user ? await SecurityQuestions.findOne({ user: user._id }) : null;

  const ids =
    record && record.questions.length === 3
      ? record.questions.map((q) => q.questionId)
      : fakeQuestionIds(email);

  res.status(200).json({ success: true, data: { questionIds: ids } });
});

// POST /api/auth/recover/questions/verify
export const verifyQuestionRecovery = catchAsync(async (req, res, next) => {
  const email = req.body.email.trim().toLowerCase();
  const { answers } = req.body;

  const user = await User.findOne({ email });
  const record = user ? await SecurityQuestions.findOne({ user: user._id }) : null;
  const dummy = await getDummyHash();

  const stored = record && record.questions.length === 3 ? record.questions : null;
  let allCorrect = !!stored;

  // Always run exactly 3 bcrypt compares to equalize timing.
  for (let i = 0; i < 3; i++) {
    const a = answers[i] || {};
    const match = stored && stored.find((q) => q.questionId === a.questionId);
    const hash = match ? match.answerHash : dummy;
    const ok = await bcrypt.compare(normalizeAnswer(a.answer), hash);
    if (!match || !ok) allCorrect = false;
  }
  // All three stored questions must be answered exactly once.
  if (stored) {
    const given = new Set(answers.map((a) => a && a.questionId));
    if (given.size !== 3 || !stored.every((q) => given.has(q.questionId))) {
      allCorrect = false;
    }
  }

  if (!allCorrect) {
    if (user) {
      recordAudit({
        action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET_REQUEST,
        actor: user._id,
        req,
        targetType: "User",
        targetId: user._id.toString(),
        status: "failure",
        metadata: { method: "security_questions" },
      });
    }
    return next(new APIError(GENERIC_FAIL, 400));
  }

  // Issue the SAME reset token as the forgot-password flow (6-digit OTP, bcrypt
  // hashed, 15 min, single use) and consume it via POST /reset-password.
  const otp = generateOtp();
  user.resetTokenHash = await hashOtp(otp);
  user.resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);
  await user.save();

  logger.info(`Security-question recovery verified for user ${user._id}`);
  recordAudit({
    action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET_REQUEST,
    actor: user._id,
    req,
    targetType: "User",
    targetId: user._id.toString(),
    status: "success",
    metadata: { method: "security_questions" },
  });

  res.status(200).json({
    success: true,
    message: "Verified. Use this code with /api/auth/reset-password within 15 minutes.",
    data: { email, otp },
  });
});
