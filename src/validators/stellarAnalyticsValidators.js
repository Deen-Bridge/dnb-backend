// validators/stellarAnalyticsValidators.js
import { query } from "express-validator";
import mongoose from "mongoose";
import { getSupportedCodes } from "../config/assets.js";
import { SUPPORTED_PERIODS } from "../services/stellar/analyticsService.js";

/**
 * express-validator chains for the payment analytics endpoints.
 *
 * All parameters are optional query-string filters. Enums are validated against
 * the same sources of truth used by the Transaction model so the analytics API
 * cannot drift from the schema.
 *
 * @module validators/stellarAnalyticsValidators
 */

const TRANSACTION_STATUSES = [
  "pending",
  "submitted",
  "retrying",
  "confirmed",
  "failed",
  "expired",
  "refunded",
  "disputed",
];

const TRANSACTION_TYPES = ["purchase", "donation"];

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

/** Filters shared by every analytics endpoint. */
const commonFilters = [
  query("status")
    .optional()
    .isIn(TRANSACTION_STATUSES)
    .withMessage(`status must be one of: ${TRANSACTION_STATUSES.join(", ")}`),
  query("type")
    .optional()
    .isIn(TRANSACTION_TYPES)
    .withMessage(`type must be one of: ${TRANSACTION_TYPES.join(", ")}`),
  query("currency")
    .optional()
    .isIn(getSupportedCodes())
    .withMessage(`currency must be a supported asset code`),
  query("buyerId")
    .optional()
    .custom(isValidObjectId)
    .withMessage("buyerId must be a valid Mongo ObjectId"),
  query("creatorId")
    .optional()
    .custom(isValidObjectId)
    .withMessage("creatorId must be a valid Mongo ObjectId"),
  query("startDate")
    .optional()
    .isISO8601()
    .withMessage("startDate must be an ISO 8601 date")
    .toDate(),
  query("endDate")
    .optional()
    .isISO8601()
    .withMessage("endDate must be an ISO 8601 date")
    .toDate(),
];

/** Validation for endpoints that accept a time-bucket `period`. */
export const analyticsTimeSeriesValidation = [
  query("period")
    .optional()
    .isIn(SUPPORTED_PERIODS)
    .withMessage(`period must be one of: ${SUPPORTED_PERIODS.join(", ")}`),
  ...commonFilters,
];

/** Validation for the summary endpoint (no `period`). */
export const analyticsSummaryValidation = [...commonFilters];

export default {
  analyticsTimeSeriesValidation,
  analyticsSummaryValidation,
};
