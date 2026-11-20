import crypto from "crypto";
import logger from "../config/logger.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_COOKIE = "csrfToken";
const CSRF_HEADER = "x-csrf-token";
const CSRF_COOKIE_PATH = "/api/auth/refresh";

const DEFAULT_BROWSER_ORIGINS = [
  "https://dnb-frontend.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "https://deenbridge.vercel.app",
  "http://deenbridge.vercel.app",
];

export const getAllowedBrowserOrigins = () => {
  const configured = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_BROWSER_ORIGINS, ...configured]);
};

export const isAllowedBrowserOrigin = (origin) =>
  typeof origin === "string" &&
  origin !== "null" &&
  getAllowedBrowserOrigins().has(origin);

export const createCsrfToken = () => crypto.randomBytes(32).toString("hex");

export const setCsrfCookie = (res, token = createCsrfToken()) => {
  const isProd = process.env.NODE_ENV === "production";

  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    path: CSRF_COOKIE_PATH,
  });

  return token;
};

export const clearCsrfCookie = (res) => {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie(CSRF_COOKIE, {
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    path: CSRF_COOKIE_PATH,
  });
};

const getRequestOrigin = (req) => {
  const origin = req.headers.origin;
  if (origin) return origin;

  const referer = req.headers.referer;
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
};

const tokensMatch = (cookieToken, headerToken) => {
  if (
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    cookieToken.length !== headerToken.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(cookieToken, "utf8"),
    Buffer.from(headerToken, "utf8")
  );
};

/**
 * Protect state-changing requests that carry the browser refresh-token cookie.
 *
 * Bearer-token and service-auth requests do not carry this cookie and remain
 * unaffected. Browser clients must send the readable csrfToken cookie back in
 * X-CSRF-Token and include an approved Origin (or Referer).
 */
export const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || !req.cookies?.refreshToken) {
    return next();
  }

  const origin = getRequestOrigin(req);
  if (!isAllowedBrowserOrigin(origin)) {
    logger.warn({ method: req.method, path: req.path, origin }, "CSRF origin rejected");
    return res.status(403).json({
      success: false,
      message: "Cross-origin request rejected",
      code: "CSRF_ORIGIN_REJECTED",
    });
  }

  if (!tokensMatch(req.cookies[CSRF_COOKIE], req.get(CSRF_HEADER))) {
    logger.warn({ method: req.method, path: req.path, origin }, "CSRF token rejected");
    return res.status(403).json({
      success: false,
      message: "CSRF token required",
      code: "CSRF_TOKEN_REQUIRED",
    });
  }

  return next();
};

export { CSRF_COOKIE, CSRF_HEADER };
