// utils/captcha.js
//
// Pluggable captcha gate for burst-mitigation on auth endpoints.
//
// No-op when CAPTCHA_SECRET_KEY is unset — so local, dev, and test flows are
// never blocked by an unconfigured integration. When configured, verifies a
// client token against the provider's siteverify endpoint (hCaptcha and
// Google reCAPTCHA v2/v3 share the same POST + form-encoded protocol), and
// fails OPEN (logs + allows) if the captcha provider is unreachable so a
// captcha outage does not lock users out.
import axios from "axios";
import logger from "../config/logger.js";

const CAPTCHA_VERIFY_URL =
  process.env.CAPTCHA_VERIFY_URL || "https://hcaptcha.com/siteverify";

/**
 * Verify a captcha token. Returns true when captcha is not configured
 * (no-op), when the token passes, or when the provider is unreachable
 * (fail-open). Returns false only when a configured provider rejects the token.
 *
 * @param {string} [token]
 * @returns {Promise<boolean>}
 */
export async function verifyCaptcha(token) {
  const secret = process.env.CAPTCHA_SECRET_KEY;
  if (!secret) return true; // not configured — no-op

  try {
    const { data } = await axios.post(
      CAPTCHA_VERIFY_URL,
      new URLSearchParams({ secret, response: token || "" })
    );
    return Boolean(data && data.success === true);
  } catch (err) {
    logger.warn(
      { err: err.message },
      "captcha: verification failed, failing open"
    );
    return true;
  }
}

export default verifyCaptcha;
