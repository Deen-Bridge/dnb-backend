/**
 * Standard error codes for consistent API error responses.
 *
 * Every error returned by the API must include one of these codes in
 * `error.code`. The code is machine-readable; the `error.message` is
 * human-readable and may vary.
 */

export const ERROR_CODES = {
  // Client errors (4xx)
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  NETWORK_UNAVAILABLE: "NETWORK_UNAVAILABLE",

  // Payment / Stellar errors (4xx)
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_REJECTED: "PAYMENT_REJECTED",
  WALLET_MISMATCH: "WALLET_MISMATCH",
  WALLET_NOT_CONNECTED: "WALLET_NOT_CONNECTED",
  ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
  ALREADY_PURCHASED: "ALREADY_PURCHASED",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  STALE_XDR: "STALE_XDR",
  INVALID_XDR: "INVALID_XDR",
  SPONSORSHIP_REJECTED: "SPONSORSHIP_REJECTED",

  // Server errors (5xx)
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
};

/**
 * Build a standard error response body.
 *
 * @param {string} code - One of ERROR_CODES
 * @param {string} message - Human-readable message
 * @param {Array<{field?: string, message: string}>} [details] - Optional field-level errors
 * @returns {{ success: boolean, error: { code: string, message: string, details?: Array } }}
 */
export const buildErrorResponse = (code, message, details, statusCode) => {
  const status = statusCode && `${statusCode}`.startsWith("4") ? "fail" : "error";
  return {
    success: false,
    // Top-level `message`, `status`, `data`, and `errors` kept for backward
    // compatibility with existing clients and tests.
    status,
    message,
    data: null,
    ...(details && details.length > 0 && { errors: details }),
    error: {
      code,
      message,
      ...(details && details.length > 0 && { details }),
    },
  };
};
