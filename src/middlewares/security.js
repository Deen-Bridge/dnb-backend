import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import logger from "../config/logger.js";

/**
 * Helmet - Sets various HTTP headers for security
 */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

/**
 * Rate Limiting - Prevents brute force attacks
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: "Too many requests, please try again later.",
    });
  },
});

/**
 * Make a rate limiter configured from env overrides.
 * @param {number} defaultMax    – default max requests in the window
 * @param {number} defaultWindow – default window in ms
 * @param {string} prefix        – env var prefix (e.g. "RATE_LIMIT_AUTH")
 */
function makeLimiter(defaultMax, defaultWindow, prefix) {
  const max = parseInt(process.env[`${prefix}_MAX`], 10) || defaultMax;
  const windowMs =
    parseInt(process.env[`${prefix}_WINDOW_MS`], 10) || defaultWindow;
  const skip = () => process.env[`${prefix}_DISABLE`] === "true";
  return rateLimit({
    windowMs,
    max,
    skip,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn(`Rate limit exceeded for ${prefix} – IP: ${req.ip}`);
      res.status(429).json({
        success: false,
        message: "Too many requests, please try again later.",
      });
    },
  });
}

/**
 * Moderate – for mutation endpoints (purchase, email, upload, payouts).
 * 100 requests per 15 minutes by default.
 */
export const standardLimiter = makeLimiter(
  100,
  15 * 60 * 1000,
  "RATE_LIMIT_STANDARD",
);

/**
 * Generous – for read-heavy & content endpoints (courses, books, reels,
 * spaces, search, progress, notifications, stellar).
 * 500 requests per 15 minutes by default.
 */
export const generousLimiter = makeLimiter(
  500,
  15 * 60 * 1000,
  "RATE_LIMIT_GENEROUS",
);

/**
 * Strict rate limiting for authentication routes
 */
export const authLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 5, // Limit each IP to 5 login requests per windowMs
  message: "Too many login attempts, please try again later.",
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === "test",
  handler: (req, res) => {
    logger.warn(`Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: "Too many login attempts. Please try again later.",
    });
  },
});

/**
 * Rate limiting specifically for token refresh route
 */
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 refresh requests per windowMs
  message: "Too many refresh attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  handler: (req, res) => {
    logger.warn(`Refresh rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: "Too many refresh attempts, please try again later.",
    });
  },
});

/**
 * MongoDB Injection Protection
 * Custom implementation for Express 5 compatibility
 * Sanitizes user input to prevent NoSQL injection attacks
 */
export const mongoSanitizeMiddleware = (req, res, next) => {
  const sanitize = (obj) => {
    if (obj && typeof obj === "object") {
      Object.keys(obj).forEach((key) => {
        // Remove keys starting with $ or containing .
        if (key.startsWith("$") || key.includes(".")) {
          logger.warn(
            `Sanitized potentially malicious key: ${key} from IP: ${req.ip}`
          );
          delete obj[key];
        } else if (typeof obj[key] === "object" && obj[key] !== null) {
          sanitize(obj[key]);
        }
      });
    }
    return obj;
  };

  if (req.body) req.body = sanitize(req.body);
  if (req.params) req.params = sanitize(req.params);
  // Note: req.query is read-only in Express 5, skip sanitization

  next();
};

/**
 * HTTP Parameter Pollution Protection
 * Prevents attacks that send multiple parameters with the same name
 */
export const hppMiddleware = hpp({
  whitelist: [
    // Add parameters that are allowed to be arrays
    "tags",
    "categories",
    "interests",
  ],
});

/**
 * Custom security headers middleware
 */
export const customSecurityHeaders = (req, res, next) => {
  // Remove powered by header
  res.removeHeader("X-Powered-By");

  // Add custom security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );

  next();
};

/**
 * Request logging middleware
 */
export const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logMessage = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms - IP: ${req.ip}`;

    if (res.statusCode >= 400) {
      logger.warn(logMessage);
    } else {
      logger.http(logMessage);
    }
  });

  next();
};

/**
 * IP Whitelist/Blacklist middleware (optional)
 */
export const ipFilter = (req, res, next) => {
  const blockedIPs = process.env.BLOCKED_IPS?.split(",") || [];
  const clientIP = req.ip || req.connection.remoteAddress;

  if (blockedIPs.includes(clientIP)) {
    logger.error(`Blocked IP attempted access: ${clientIP}`);
    return res.status(403).json({
      success: false,
      message: "Access denied",
    });
  }

  next();
};

export default {
  helmetMiddleware,
  standardLimiter,
  generousLimiter,
  authLimiter,
  refreshLimiter,
  mongoSanitizeMiddleware,
  hppMiddleware,
  customSecurityHeaders,
  requestLogger,
  ipFilter,
};
