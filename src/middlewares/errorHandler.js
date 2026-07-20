import logger from "../config/logger.js";

export class APIError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    Error.captureStackTrace(this, this.constructor);
  }
}

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new APIError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg?.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new APIError(message, 400);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data. ${errors.join(". ")}`;
  return new APIError(message, 400);
};

const handleJWTError = () =>
  new APIError("Invalid token. Please log in again!", 401);

const handleJWTExpiredError = () =>
  new APIError("Your token has expired! Please log in again.", 401);

const sendErrorDev = (err, req, res) => {
  const logData = { status: err.status, message: err.message, stack: err.stack };
  if (req?.id) logData.reqId = req.id;
  logger.error(logData, "ERROR");

  res.status(err.statusCode).json({
    success: false,
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
    reqId: req?.id,
  });
};

const sendErrorProd = (err, req, res) => {
  if (err.isOperational) {
    const logData = { statusCode: err.statusCode, message: err.message };
    if (req?.id) logData.reqId = req.id;
    logger.error(logData, "Operational Error");

    res.status(err.statusCode).json({
      success: false,
      status: err.status,
      message: err.message,
      reqId: req?.id,
    });
  } else {
    const logData = { error: err, message: err.message, stack: err.stack };
    if (req?.id) logData.reqId = req.id;
    logger.error(logData, "Programming Error");

    res.status(500).json({
      success: false,
      status: "error",
      message: "Something went wrong!",
      reqId: req?.id,
    });
  }
};

export const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  if (process.env.NODE_ENV === "development") {
    sendErrorDev(err, req, res);
  } else {
    let error = { ...err };
    error.message = err.message;

    if (err.name === "CastError") error = handleCastErrorDB(err);
    if (err.code === 11000) error = handleDuplicateFieldsDB(err);
    if (err.name === "ValidationError") error = handleValidationErrorDB(err);
    if (err.name === "JsonWebTokenError") error = handleJWTError();
    if (err.name === "TokenExpiredError") error = handleJWTExpiredError();

    sendErrorProd(error, req, res);
  }
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
