// utils/courseBundleErrors.js
// Error contract for the course-bundle API (issue #697). Translates service and
// driver failures into the documented status codes and makes every failure
// observable (structured log + metric + audit for authorization denials)
// without leaking exception messages, stack traces or database details.
import { APIError } from "../middlewares/errorHandler.js";
import { ERROR_CODES } from "../config/errorCodes.js";
import logger from "../config/logger.js";
import { recordCourseBundleRequest } from "../config/metrics.js";
import { recordAudit } from "../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";

const DATABASE_UNAVAILABLE_ERRORS = new Set([
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoServerSelectionError",
  "MongooseServerSelectionError",
  "MongoNotConnectedError",
  "MongoTopologyClosedError",
  "MongoPoolClearedError",
  "MongoWaitQueueTimeoutError",
]);

// MongoDB WriteConflict; withTransaction retries these until it gives up.
const WRITE_CONFLICT_CODE = 112;
const DUPLICATE_KEY_CODE = 11000;

const hasLabel = (error, label) =>
  typeof error?.hasErrorLabel === "function" && error.hasErrorLabel(label);

const isDatabaseUnavailable = (error) =>
  DATABASE_UNAVAILABLE_ERRORS.has(error?.name) ||
  // Mongoose buffers commands while disconnected and fails them on timeout.
  (error?.name === "MongooseError" && /buffering timed out/i.test(error.message || ""));

const isConcurrentModification = (error) =>
  error?.name === "VersionError" ||
  error?.code === WRITE_CONFLICT_CODE ||
  error?.code === DUPLICATE_KEY_CODE ||
  hasLabel(error, "TransientTransactionError");

/**
 * Normalize any error thrown while serving a bundle request into one the
 * central error handler renders with the documented status code. Unexpected
 * errors are passed through untouched: they are not operational, so the
 * handler answers 500 with a generic message and keeps the details in logs.
 *
 * @param {unknown} error
 * @returns {Error}
 */
export const toBundleApiError = (error) => {
  if (error instanceof APIError) return error;
  if (error?.name === "CastError") return new APIError("Invalid input data.", 400);
  if (isConcurrentModification(error)) {
    return new APIError("The bundle was changed by another request. Please retry.", 409);
  }
  if (isDatabaseUnavailable(error)) {
    const unavailable = new APIError(
      "Course bundles are temporarily unavailable. Please retry shortly.",
      503
    );
    unavailable.errorCode = ERROR_CODES.DATABASE_ERROR;
    return unavailable;
  }
  return error;
};

const statusOf = (error) => {
  if (Number.isInteger(error?.statusCode)) return error.statusCode;
  // Mongoose ValidationError is rendered as a 400 by the central handler.
  return error?.name === "ValidationError" ? 400 : 500;
};

const OUTCOME_BY_STATUS = {
  400: "validation_failed",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  503: "dependency_failure",
};

/** Map an HTTP status to the bounded `outcome` metric label. */
export const outcomeForStatus = (statusCode) => OUTCOME_BY_STATUS[statusCode] || "error";

/**
 * Wrap a bundle controller so successes and failures are counted per
 * operation, failures are logged with request context, ownership denials are
 * audited, and the normalized error is forwarded to the central handler.
 *
 * @param {string} operation - Bounded operation label (see metrics.js)
 * @param {(req: import("express").Request, res: import("express").Response) => Promise<void>} handler
 */
export const bundleHandler = (operation, handler) => async (req, res, next) => {
  try {
    await handler(req, res);
    recordCourseBundleRequest(operation, "success");
  } catch (rawError) {
    const error = toBundleApiError(rawError);
    const statusCode = statusOf(error);
    const outcome = outcomeForStatus(statusCode);
    recordCourseBundleRequest(operation, outcome);

    const logEntry = {
      event: "course_bundle_request_failed",
      operation,
      outcome,
      statusCode,
      errorName: typeof rawError?.name === "string" ? rawError.name : "Error",
      reqId: req.id,
      bundleId: req.params?.id,
    };
    if (statusCode >= 500) logger.error(logEntry, "Course bundle request failed");
    else logger.warn(logEntry, "Course bundle request rejected");

    if (statusCode === 403 && req.user?._id) {
      recordAudit({
        action: AUDIT_ACTIONS.AUTHZ_OWNERSHIP_DENIED,
        actor: req.user._id,
        req,
        targetType: "CourseBundle",
        targetId: req.params?.id ?? null,
        status: "failure",
        metadata: { reason: `course bundle ${operation} denied`, role: req.user.role },
      });
    }

    next(error);
  }
};
