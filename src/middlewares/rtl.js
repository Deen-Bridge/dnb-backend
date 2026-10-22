import logger from "../config/logger.js";

const RTL_LANGUAGES = ["ar", "ar-AE", "ar-SA", "ar-EG", "ar-MA", "ur", "ur-PK", "ur-IN", "fa", "he", "yi"];

/**
 * RTL detection middleware.
 * Reads the Accept-Language header and attaches `req.textDirection`
 * ("ltr" | "rtl") plus `req.isRTL` for convenience.
 */
export const rtlMiddleware = (req, res, next) => {
  const acceptLanguage = req.headers["accept-language"] || "";
  const primary = acceptLanguage.split(",")[0]?.split("-")[0]?.split(";")[0]?.trim().toLowerCase() || "";

  const isRTL = RTL_LANGUAGES.some(
    (lang) => primary === lang.toLowerCase() || primary === lang.split("-")[0].toLowerCase()
  );

  req.textDirection = isRTL ? "rtl" : "ltr";
  req.isRTL = isRTL;

  res.setHeader("Content-Language", primary || "en");
  res.setHeader("X-Text-Direction", req.textDirection);

  next();
};

export default rtlMiddleware;
