import { validationResult } from "express-validator";
import { APIError } from "./errorHandler.js";
import logger from "../config/logger.js";

/**
 * Validation middleware
 * Checks for validation errors from express-validator
 */
export const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const validationErrors = errors
      .array({ onlyFirstError: true })
      .map((err) => ({
        field: err.path || err.param || "request",
        message: err.msg,
      }));
    logger.warn(
      `Validation failed for ${req.originalUrl}:`,
      validationErrors.map(({ field, message }) => `${field}: ${message}`)
    );

    return next(
      new APIError("Validation failed", 400, true, validationErrors)
    );
  }

  next();
};

/**
 * Sanitize input to prevent XSS attacks
 */
export const sanitizeInput = (req, res, next) => {
  // Remove any HTML tags from string fields
  const sanitizeObject = (obj) => {
    for (let key in obj) {
      if (typeof obj[key] === "string") {
        // Remove HTML tags
        obj[key] = obj[key].replace(/<[^>]*>/g, "");
        // Remove script tags content
        obj[key] = obj[key].replace(
          /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
          ""
        );
      } else if (typeof obj[key] === "object" && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  };

  if (req.body) sanitizeObject(req.body);
  if (req.query) sanitizeObject(req.query);
  if (req.params) sanitizeObject(req.params);

  next();
};

/**
 * Check if required fields are present
 */
export const requireFields = (fields) => {
  return (req, res, next) => {
    const missingFields = fields.filter((field) => !req.body[field]);

    if (missingFields.length > 0) {
      logger.warn(`Missing required fields: ${missingFields.join(", ")}`);
      return next(
        new APIError(
          "Validation failed",
          400,
          true,
          missingFields.map((field) => ({
            field,
            message: `${field} is required`,
          }))
        )
      );
    }

    next();
  };
};

export default {
  validate,
  sanitizeInput,
  requireFields,
};
