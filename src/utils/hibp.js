// utils/hibp.js
//
// Breached-password check against the HaveIBeenPwned (HIBP) k-anonymity range
// API (https://haveibeenpwned.com/API/v3#PwnedPasswords).
//
// Security model: the full password is NEVER sent. We send only the first 5
// hex characters of its SHA-1 digest (the "prefix"), and the API returns every
// known-breach suffix for that prefix. We compare locally. Because the request
// is keyed on a 20-bit prefix shared by ~millions of passwords, HIBP learns
// nothing about the specific password.
//
// Fail-open policy: on any network error / timeout / outage we return `false`
// (not breached) and log, so a HIBP outage never blocks legitimate signups or
// password resets. The static password policy (passwordPolicy.js) remains the
// hard boundary; this check is a progressive hardening layer on top.
import axios from "axios";
import crypto from "crypto";
import logger from "../config/logger.js";

const HIBP_RANGE_URL =
  process.env.HIBP_RANGE_URL || "https://api.pwnedpasswords.com/range/";
const HIBP_TIMEOUT_MS = parseInt(process.env.HIBP_TIMEOUT_MS, 10) || 2000;

/**
 * Returns true when the password has appeared in a known breach.
 * Only the 5-char SHA-1 prefix is transmitted; the password never leaves the
 * process. Fails open (returns false) on outage/timeout and logs the degraded
 * state.
 *
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export async function isPasswordBreached(password) {
  if (typeof password !== "string" || password.length === 0) {
    return false;
  }

  const sha1 = crypto
    .createHash("sha1")
    .update(password)
    .digest("hex")
    .toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const { data } = await axios.get(`${HIBP_RANGE_URL}${prefix}`, {
      timeout: HIBP_TIMEOUT_MS,
      headers: {
        "User-Agent": "DeenBridgeBackend/1.0",
        // Ask HIBP to append padding records so responses are a fixed size and
        // cannot be fingerprinted over TLS.
        "Add-Padding": "true",
      },
    });
    // Each line is "<suffix>:<occurrence-count>". Padding records have count 0
    // and must be ignored — a real breach always has count >= 1.
    const records = String(data || "")
      .split("\n")
      .map((line) => line.trim().split(":"))
      .filter((parts) => parts.length >= 2)
      .filter((parts) => parseInt(parts[1], 10) > 0);
    const breached = records.some(
      (parts) => parts[0].toUpperCase() === suffix
    );

    if (breached) {
      logger.warn("hibp: password is present in a known breach");
    }
    return breached;
  } catch (err) {
    // Fail open — never break signup/reset because HIBP is unreachable.
    logger.warn(
      { err: err.message },
      "hibp: breached-password check unavailable, failing open"
    );
    return false;
  }
}

export default isPasswordBreached;
