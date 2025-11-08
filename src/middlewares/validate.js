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
    const errorMessages = errors.array().map((err) => err.msg);
    logger.warn(`Validation failed for ${req.originalUrl}:`, errorMessages);

    return next(
      new APIError(`Validation Error: ${errorMessages.join(", ")}`, 400)
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
          `Missing required fields: ${missingFields.join(", ")}`,
          400
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
