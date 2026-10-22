import { isBlocked } from "../services/fail2ban.service.js";
import { ERROR_CODES, buildErrorResponse } from "../config/errorCodes.js";

/**
 * Rejects requests from IPs blocked by the progressive fail2ban service.
 * Uses req.ip (honours the app's `trust proxy` setting); never reads
 * X-Forwarded-For directly. Fails open if Redis is unavailable.
 */
export const ipBlockMiddleware = async (req, res, next) => {
  try {
    const info = await isBlocked(req.ip);
    if (!info.blocked) return next();
    if (info.retryAfterSec) res.setHeader("Retry-After", String(info.retryAfterSec));
    return res
      .status(429)
      .json(
        buildErrorResponse(
          ERROR_CODES.RATE_LIMITED,
          "Too many failed attempts. This IP is temporarily blocked.",
          undefined,
          429
        )
      );
  } catch {
    return next();
  }
};

export default ipBlockMiddleware;
