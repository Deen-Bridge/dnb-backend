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
  const message = `Invalid ${err.path}: ${err.value}`;
  return new APIError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg?.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new APIError(message, 409);
};

const handleValidationErrorDB = (err) => {
  const details = Object.entries(err.errors).map(([field, el]) => ({
    field,
    message: el.message,
  }));
  const message = `Invalid input data. ${details.map((d) => d.message).join(". ")}`;
  const apiError = new APIError(message, 400);
  apiError.details = details;
  return apiError;
};

const handleJWTError = () =>
  new APIError("Invalid token. Please log in again!", 401);

const handleJWTExpiredError = () =>
  new APIError("Your token has expired! Please log in again.", 401);

/**
 * Map an APIError (or translated error) to the standard response envelope:
 *   { success: false, error: { code, message, details? } }
 *
 * In development we also include `stack` and `reqId` for debugging.
 */
const sendError = (err, req, res) => {
  const code = err.errorCode || ERROR_CODES.INTERNAL_ERROR;
  // `err.errors` comes from APIError (used by validate.js for field-level
  // validation errors); `err.details` is the explicit field name.
  const details = err.errors || err.details || undefined;

  if (process.env.NODE_ENV === "development") {
    const logData = { status: err.status, message: err.message, stack: err.stack };
    if (req?.id) logData.reqId = req.id;
    logger.error(logData, "ERROR");

    return res.status(err.statusCode).json({
      ...buildErrorResponse(code, err.message, details, err.statusCode),
      stack: err.stack,
      reqId: req?.id,
    });
  }

  // Production: hide internal details
  const publicMessage = err.isOperational ? err.message : "Something went wrong!";
  const logData = { statusCode: err.statusCode, message: err.message };
  if (!err.isOperational) logData.stack = err.stack;
  if (req?.id) logData.reqId = req.id;
  logger.error(logData, err.isOperational ? "Operational Error" : "Programming Error");

  res.status(err.statusCode).json({
    ...buildErrorResponse(code, publicMessage, details, err.statusCode),
    ...(req?.id && { reqId: req.id }),
  });
};

export const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
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
    return res.status(503).json(
      buildErrorResponse(ERROR_CODES.NETWORK_UNAVAILABLE, "Stellar network currently unreachable. Please try again later.", undefined, 503)
    );
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
    fn(req, res, next).catch(next);
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
