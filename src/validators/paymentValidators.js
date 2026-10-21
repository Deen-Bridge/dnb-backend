import { body, param } from "express-validator";
import mongoose from "mongoose";
import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Strict request validators for payout, payment, refund, donation, gift and
 * pledge routes. Applied AFTER auth and BEFORE idempotency/controllers so
 * malformed input is rejected before any DB or ledger interaction.
 */

// Stellar max int64 stroops = 922337203685.4775807 units
const MAX_STELLAR_AMOUNT = 922337203685.4775;
const MAX_XDR_LENGTH = 100000;
const MAX_TEXT_LENGTH = 2000;

const isObjectId = (value) =>
  typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value) && mongoose.Types.ObjectId.isValid(value);

/** Strict Stellar G... address: 56 chars, base32 [A-Z2-7], valid checksum. */
export const isStrictStellarAddress = (value) =>
  typeof value === "string" &&
  /^G[A-Z2-7]{55}$/.test(value) &&
  StellarSdk.StrKey.isValidEd25519PublicKey(value);

/** Amount as string or number: > 0 (or >= 0 when allowZero), <= 7 decimals. */
export const isValidStellarAmount = (value, { allowZero = false } = {}) => {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const str = String(value);
  if (!/^\d+(\.\d{1,7})?$/.test(str)) return false;
  const num = Number(str);
  if (!Number.isFinite(num) || num > MAX_STELLAR_AMOUNT) return false;
  return allowZero ? num >= 0 : num > 0;
};

const isAssetCode = (value) =>
  typeof value === "string" && /^[A-Za-z0-9]{1,12}$/.test(value);

const msgObjectId = (f) => `${f} must be a valid Mongo ObjectId`;

const objectIdParam = (name) =>
  param(name).custom(isObjectId).withMessage(msgObjectId(name));

const objectIdBody = (name, { optional = false } = {}) => {
  const chain = body(name);
  if (optional) chain.optional({ values: "undefined" });
  return chain.custom(isObjectId).withMessage(msgObjectId(name));
};

const amountBody = (name, { optional = false, allowZero = false } = {}) => {
  const chain = body(name);
  if (optional) chain.optional({ values: "undefined" });
  return chain
    .custom((v) => isValidStellarAmount(v, { allowZero }))
    .withMessage(
      `${name} must be a ${allowZero ? "non-negative" : "positive"} amount with at most 7 decimal places`
    );
};

const addressBody = (name, { optional = false } = {}) => {
  const chain = body(name);
  if (optional) chain.optional({ values: "undefined" });
  return chain
    .custom(isStrictStellarAddress)
    .withMessage(`${name} must be a valid Stellar public key (G...)`);
};

const assetCodeBody = (name, { optional = false } = {}) => {
  const chain = body(name);
  if (optional) chain.optional({ values: "undefined" });
  return chain
    .custom(isAssetCode)
    .withMessage(`${name} must be 1-12 alphanumeric characters`);
};

const xdrBody = (name) =>
  body(name)
    .isString()
    .withMessage(`${name} must be a string`)
    .bail()
    .trim()
    .notEmpty()
    .withMessage(`${name} is required`)
    .bail()
    .isLength({ max: MAX_XDR_LENGTH })
    .withMessage(`${name} is too long`);

const textBody = (name, { optional = false } = {}) => {
  const chain = body(name);
  if (optional) chain.optional({ values: "undefined" });
  return chain
    .isString()
    .withMessage(`${name} must be a string`)
    .bail()
    .isLength({ max: MAX_TEXT_LENGTH })
    .withMessage(`${name} must be at most ${MAX_TEXT_LENGTH} characters`);
};

const itemTypeBody = body("itemType")
  .exists({ values: "null" })
  .withMessage("itemType is required")
  .bail()
  .isIn(["book", "course"])
  .withMessage("itemType must be one of: book, course");

// ---------------------------------------------------------------- payouts
export const buildPayoutValidation = [
  body("educatorIds")
    .optional({ values: "undefined" })
    .isArray({ max: 1000 })
    .withMessage("educatorIds must be an array"),
  body("educatorIds.*").custom(isObjectId).withMessage("Each educatorId must be a valid Mongo ObjectId"),
  amountBody("minAmount", { optional: true, allowZero: true }),
  body("dryRun")
    .optional({ values: "undefined" })
    .custom((v) => typeof v === "boolean")
    .withMessage("dryRun must be a boolean"),
];

export const submitPayoutValidation = [
  objectIdParam("batchId"),
  body("signedXdrs")
    .optional({ values: "undefined" })
    .custom((v) => typeof v === "string" || Array.isArray(v))
    .withMessage("signedXdrs must be a string or an array of strings"),
  body("signedXdrs.*")
    .if(body("signedXdrs").isArray())
    .isString()
    .withMessage("each signedXdrs entry must be a string")
    .bail()
    .isLength({ min: 1, max: MAX_XDR_LENGTH })
    .withMessage("each signedXdrs entry must be a non-empty XDR string"),
  body("signedXdr")
    .optional({ values: "undefined" })
    .custom((v) => typeof v === "string" || Array.isArray(v))
    .withMessage("signedXdr must be a string or an array of strings"),
  body("signedXdr.*")
    .if(body("signedXdr").isArray())
    .isString()
    .withMessage("each signedXdr entry must be a string")
    .bail()
    .isLength({ min: 1, max: MAX_XDR_LENGTH })
    .withMessage("each signedXdr entry must be a non-empty XDR string"),
];

// --------------------------------------------------------------- payments
export const quoteValidation = [
  itemTypeBody,
  objectIdBody("itemId"),
  assetCodeBody("sendAssetCode", { optional: true }),
  addressBody("sendAssetIssuer", { optional: true }),
  body("slippageBps")
    .optional({ values: "undefined" })
    .isInt({ min: 0, max: 10000 })
    .withMessage("slippageBps must be an integer between 0 and 10000"),
];

export const preflightValidation = [itemTypeBody, objectIdBody("itemId")];

// Extra optional path-payment fields on POST /initialize (itemType/itemId/
// buyerWallet are covered by initializePaymentValidation).
export const pathPaymentValidation = [
  body("sendAsset")
    .optional({ values: "undefined" })
    .isObject()
    .withMessage("sendAsset must be an object"),
  body("sendAsset.code")
    .if(body("sendAsset").isObject())
    .custom(isAssetCode)
    .withMessage("sendAsset.code must be 1-12 alphanumeric characters"),
  body("sendAsset.issuer")
    .if(body("sendAsset").isObject())
    .optional({ values: "undefined" })
    .custom(isStrictStellarAddress)
    .withMessage("sendAsset.issuer must be a valid Stellar public key (G...)"),
  amountBody("sendMax", { optional: true }),
  body("path")
    .optional({ values: "undefined" })
    .isArray({ max: 5 })
    .withMessage("path must be an array of at most 5 assets"),
  body("path.*.asset_code")
    .optional({ values: "undefined" })
    .custom(isAssetCode)
    .withMessage("path asset_code must be 1-12 alphanumeric characters"),
  body("path.*.asset_issuer")
    .optional({ values: "undefined" })
    .custom(isStrictStellarAddress)
    .withMessage("path asset_issuer must be a valid Stellar public key (G...)"),
];

export const transactionIdParamValidation = [objectIdParam("transactionId")];

// ---------------------------------------------------------------- refunds
export const requestRefundValidation = [
  objectIdParam("id"),
  body("reason")
    .isString()
    .withMessage("reason must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("reason is required")
    .bail()
    .isLength({ max: MAX_TEXT_LENGTH })
    .withMessage(`reason must be at most ${MAX_TEXT_LENGTH} characters`),
];
export const refundIdParamValidation = [objectIdParam("refundId")];
export const submitRefundValidation = [objectIdParam("refundId"), xdrBody("signedXdr")];
export const rejectRefundValidation = [
  objectIdParam("refundId"),
  textBody("rejectionReason", { optional: true }),
];
export const arbitrateDisputeValidation = [
  objectIdParam("refundId"),
  body("decision")
    .isIn(["approved", "rejected", "off_chain_resolved"])
    .withMessage("decision must be one of: approved, rejected, off_chain_resolved"),
  textBody("notes", { optional: true }),
];

// -------------------------------------------------------------- donations
export const initializeDonationValidation = [
  amountBody("amount"),
  addressBody("publicKey"),
];
export const submitDonationValidation = [
  objectIdBody("donationId"),
  xdrBody("signedXdr"),
  body("requestSponsorship")
    .optional({ values: "undefined" })
    .custom((v) => typeof v === "boolean")
    .withMessage("requestSponsorship must be a boolean"),
];

// ------------------------------------------------------------------ gifts
export const initializeGiftValidation = [
  itemTypeBody,
  objectIdBody("itemId"),
  objectIdBody("recipientUserId"),
];
export const submitGiftValidation = [objectIdBody("giftId"), xdrBody("signedXdr")];
export const giftClaimInitializeValidation = [objectIdParam("id")];
export const giftClaimSubmitValidation = [objectIdParam("id"), xdrBody("signedXdr")];

// ---------------------------------------------------------------- pledges
export const createPledgeValidation = [
  addressBody("publicKey"),
  amountBody("amount"),
  body("cadence")
    .isIn(["daily", "weekly", "monthly"])
    .withMessage("cadence must be one of: daily, weekly, monthly"),
  body("anchorDay")
    .optional({ values: "undefined" })
    .isInt({ min: 0, max: 6 })
    .withMessage("anchorDay must be between 0 and 6"),
  body("anchorDate")
    .optional({ values: "undefined" })
    .isInt({ min: 1, max: 31 })
    .withMessage("anchorDate must be between 1 and 31"),
  body("startAt")
    .optional({ values: "undefined" })
    .custom((v) => (typeof v === "string" || typeof v === "number") && !Number.isNaN(new Date(v).getTime()))
    .withMessage("startAt must be a valid date"),
];
export const updatePledgeStatusValidation = [
  objectIdParam("id"),
  body("status")
    .isIn(["active", "paused", "cancelled"])
    .withMessage("status must be one of: active, paused, cancelled"),
];
export const pledgeCycleParamValidation = [objectIdParam("cycleId")];
export const pledgeCycleSubmitValidation = [
  objectIdParam("cycleId"),
  xdrBody("signedXdr"),
  body("requestSponsorship")
    .optional({ values: "undefined" })
    .custom((v) => typeof v === "boolean")
    .withMessage("requestSponsorship must be a boolean"),
];
