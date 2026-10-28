import { body } from "express-validator";

/**
 * Request validation for the auth routes that take a body but were not yet
 * covered (register and login live in requestValidators.js).
 *
 * These validators check presence, type and shape only. They deliberately:
 *  - do NOT apply password-strength rules to login or to current passwords;
 *  - do NOT alter password / token / OTP values (no trim, no sanitising);
 *  - do NOT normalize emails: the controllers look users up by the raw value,
 *    so rewriting it here would change which account is matched;
 *  - leave strength / breach checks for new passwords to the controllers
 *    (firstPasswordIssue needs the name/email context and owns the messages).
 * Failures return the shared 400 "Validation failed" shape and never say
 * whether an account exists.
 */

const MAX_FIELD_LENGTH = 1024;

const requiredString = (field, label = field) =>
  body(field)
    .exists({ values: "null" })
    .withMessage(`${label} is required`)
    .bail()
    .isString()
    .withMessage(`${label} must be a string`)
    .bail()
    .custom((value) => value.trim().length > 0)
    .withMessage(`${label} is required`)
    .bail()
    .isLength({ max: MAX_FIELD_LENGTH })
    .withMessage(`${label} is too long`);

const optionalString = (field, label = field) =>
  body(field)
    .optional({ values: "null" })
    .isString()
    .withMessage(`${label} must be a string`)
    .bail()
    .isLength({ max: MAX_FIELD_LENGTH })
    .withMessage(`${label} is too long`);

// TOTP codes may arrive as a number from some clients; the controller calls
// .toString() on them.
const optionalCode = (field, label = field) =>
  body(field)
    .optional({ values: "null" })
    .custom((value) => typeof value === "string" || typeof value === "number")
    .withMessage(`${label} must be a string`)
    .bail()
    .custom((value) => String(value).length <= 64)
    .withMessage(`${label} is too long`);

const emailField = () =>
  requiredString("email", "Email")
    .bail()
    .trim()
    .isEmail()
    .withMessage("Email must be a valid email address");

export const requestPasswordResetValidation = [emailField()];

export const resendVerificationValidation = [emailField()];

export const resetPasswordValidation = [
  emailField(),
  body("otp")
    .exists({ values: "null" })
    .withMessage("OTP is required")
    .bail()
    .custom((value) => typeof value === "string" || typeof value === "number")
    .withMessage("OTP must be a string")
    .bail()
    .custom((value) => String(value).trim().length > 0)
    .withMessage("OTP is required")
    .bail()
    .custom((value) => String(value).length <= 64)
    .withMessage("OTP is too long"),
  requiredString("newPassword", "New password"),
];

// The refresh token may instead arrive via the httpOnly cookie, so it is not
// required here; the controller keeps returning 401 when neither is present.
export const refreshValidation = [optionalString("refreshToken", "Refresh token")];

export const changePasswordValidation = [
  requiredString("currentPassword", "Current password"),
  requiredString("newPassword", "New password"),
];

export const verify2FAValidation = [
  optionalCode("code", "Code"),
  optionalString("recoveryCode", "Recovery code"),
  optionalString("mfaToken", "MFA token"),
];

export const disable2FAValidation = [
  optionalCode("code", "Code"),
  optionalString("recoveryCode", "Recovery code"),
];

export const stellarVerifyValidation = [
  requiredString("transaction", "Transaction"),
];

export const googleAuthValidation = [
  requiredString("idToken", "ID token"),
];

export default {
  requestPasswordResetValidation,
  resendVerificationValidation,
  resetPasswordValidation,
  refreshValidation,
  changePasswordValidation,
  verify2FAValidation,
  disable2FAValidation,
  stellarVerifyValidation,
  googleAuthValidation,
};
