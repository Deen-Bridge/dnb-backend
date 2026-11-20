import logger from "../config/logger.js";
import { ERROR_CODES, buildErrorResponse } from "../config/errorCodes.js";

export class APIError extends Error {
  constructor(message, statusCode = 500, isOperational = true, errors) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.errorCode = this._inferErrorCode(statusCode);
    if (errors) this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }

  _inferErrorCode(statusCode) {
    if (statusCode === 400) return ERROR_CODES.VALIDATION_ERROR;
    if (statusCode === 401) return ERROR_CODES.UNAUTHORIZED;
    if (statusCode === 403) return ERROR_CODES.FORBIDDEN;
    if (statusCode === 404) return ERROR_CODES.NOT_FOUND;
    if (statusCode === 409) return ERROR_CODES.CONFLICT;
    if (statusCode === 413) return ERROR_CODES.PAYLOAD_TOO_LARGE;
    if (statusCode === 429) return ERROR_CODES.RATE_LIMITED;
    if (statusCode === 503) return ERROR_CODES.NETWORK_UNAVAILABLE;
    return ERROR_CODES.INTERNAL_ERROR;
  }
}

const handleCastErrorDB = (err) => {
  return new APIError("Invalid input data.", 400);
};

const handleDuplicateFieldsDB = (err) => {
  // Driver versions expose duplicate-key metadata as errmsg, message, or
  // keyValue. Never include any of those raw values in the public response.
  return new APIError("A record with these values already exists.", 409);
};

const handleValidationErrorDB = (err) => {
  const errors = err && typeof err.errors === "object" ? err.errors : {};
  const details = Object.keys(errors).slice(0, 20).map((field) => ({
    field: String(field).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80),
    message: "Invalid value.",
  }));
  const message = "Invalid input data.";
  const apiError = new APIError(message, 400);
  apiError.details = details;
  return apiError;
};

const handleJWTError = () =>
  new APIError("Invalid token. Please log in again!", 401);

const handleJWTExpiredError = () =>
  new APIError("Your token has expired! Please log in again.", 401);

const sanitizeDetails = (details) => {
  if (!Array.isArray(details)) return undefined;
  return details.slice(0, 20).map((detail) => ({
    field: typeof detail?.field === "string"
      ? detail.field.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80)
      : "input",
    message: "Invalid value.",
  }));
};

/**
 * Map an APIError (or translated error) to the standard response envelope:
 *   { success: false, error: { code, message, details? } }
 *
 * Debug details are opt-in. Unknown or misconfigured environments receive
 * the same safe response as production.
 */
const sendError = (err, req, res) => {
  const safeErr = err && typeof err === "object" ? err : new Error("Unknown error");
  const code = Object.values(ERROR_CODES).includes(safeErr.errorCode)
    ? safeErr.errorCode
    : ERROR_CODES.INTERNAL_ERROR;
  // `err.errors` comes from APIError (used by validate.js for field-level
  // validation errors); `err.details` is the explicit field name.
  const details = Array.isArray(safeErr.errors)
    ? safeErr.errors
    : Array.isArray(safeErr.details) ? safeErr.details : undefined;
  const safeDetails = sanitizeDetails(details);
  const correlationId = req?.id || req?.headers?.["x-request-id"];
  const debugErrors = process.env.NODE_ENV === "development"
    && process.env.EXPOSE_ERROR_DETAILS === "true";
  const statusCode = Number.isInteger(safeErr.statusCode) && safeErr.statusCode >= 400
    ? safeErr.statusCode : 500;
  const publicMessage = safeErr.isOperational && typeof safeErr.message === "string"
    ? safeErr.message.slice(0, 300) : "Something went wrong!";
  const logData = {
    event: "api_error",
    correlationId,
    code,
    statusCode,
    errorName: typeof safeErr.name === "string" ? safeErr.name : "Error",
    ...(debugErrors && typeof safeErr.message === "string" && { message: safeErr.message.slice(0, 300) }),
    ...(!safeErr.isOperational && typeof safeErr.stack === "string" && { stack: safeErr.stack }),
  };
  try {
    logger.error(logData, safeErr.isOperational ? "Operational Error" : "Programming Error");
  } catch {
    // Error handling must not fail because a logging transport is unavailable.
  }

  const response = {
    ...buildErrorResponse(code, publicMessage, safeDetails, statusCode),
    ...(debugErrors && typeof safeErr.stack === "string" && { stack: safeErr.stack }),
    ...(correlationId && { reqId: correlationId }),
  };
  return res.status(statusCode).json(response);
};

export const errorHandler = (err, req, res, next) => {
  if (res?.headersSent) return next?.(err);
  if (!err || typeof err !== "object") err = new Error("Unknown error");
  if (!(err instanceof Error)) {
    try {
      err = Object.assign(new Error("Unknown error"), err);
    } catch {
      err = new Error("Unknown error");
    }
  }
  err.statusCode = Number.isInteger(err.statusCode) ? err.statusCode : 500;
  err.status = err.status || "error";

  if (err.name === "MulterError") {
    err.statusCode = 400;
    err.status = "fail";
    err.isOperational = true;
    err.errorCode = err.code === "LIMIT_FILE_SIZE"
      ? ERROR_CODES.PAYLOAD_TOO_LARGE
      : ERROR_CODES.VALIDATION_ERROR;
    if (err.code === "LIMIT_FILE_SIZE") {
      err.message = "File too large. Please upload a smaller file.";
    }
  }

  if (err.name === "AllEndpointsOpenError") {
    err = new APIError("Stellar network currently unreachable. Please try again later.", 503);
    err.errorCode = ERROR_CODES.NETWORK_UNAVAILABLE;
  }

  // Translate known error types into standardized APIErrors
  if (err.name === "CastError") err = handleCastErrorDB(err);
  if (err.code === 11000) err = handleDuplicateFieldsDB(err);
  if (err.name === "ValidationError") err = handleValidationErrorDB(err);
  if (err.name === "JsonWebTokenError") err = handleJWTError();
  if (err.name === "TokenExpiredError") err = handleJWTExpiredError();

  sendError(err, req, res);
};

export const catchAsync = (fn) => {
  return (req, res, next) => {
    return Promise.resolve().then(() => fn(req, res, next)).catch(next);
  };
};

export const notFound = (req, res, next) => {
  const message = `Can't find ${req.originalUrl} on this server!`;
  logger.warn({ reqId: req.id, url: req.originalUrl }, `404 - ${message}`);
  next(new APIError(message, 404));
};

export const handleUnhandledRejection = () => {
  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "UNHANDLED REJECTION! Shutting down...");
    process.exit(1);
  });
};

export const handleUncaughtException = () => {
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "UNCAUGHT EXCEPTION! Shutting down...");
    process.exit(1);
  });
};

export default {
  APIError,
  errorHandler,
  catchAsync,
  notFound,
  handleUnhandledRejection,
  handleUncaughtException,
};
