// services/stellar/onrampService.js
import crypto from "crypto";
import logger from "../../config/logger.js";
import { isValidPublicKey } from "./stellarService.js";

/**
 * Fiat on-ramp integration (MoonPay).
 *
 * Provides the widget-URL builder (with the MoonPay `signature` HMAC), webhook
 * signature verification, and provider→internal status mapping used by the
 * on-ramp controller. All provider credentials are read lazily from the
 * environment so the module imports cleanly even when nothing is configured.
 *
 * Required environment variables:
 *   - MOONPAY_API_KEY      Publishable key embedded in the widget URL.
 *   - MOONPAY_SECRET_KEY   Secret used to sign widget URLs (server-side only).
 *   - MOONPAY_WEBHOOK_KEY  Secret used to verify inbound webhook signatures.
 *                          Falls back to MOONPAY_SECRET_KEY when unset.
 * Optional:
 *   - MOONPAY_WIDGET_URL           Override the widget base URL.
 *   - MOONPAY_DEFAULT_CRYPTO_CODE  Default crypto currency code (default "usdc").
 *
 * @module services/stellar/onrampService
 */

const DEFAULT_LIVE_WIDGET_URL = "https://buy.moonpay.com";
const DEFAULT_SANDBOX_WIDGET_URL = "https://buy-sandbox.moonpay.com";
const DEFAULT_CRYPTO_CODE = "usdc";

/**
 * Read the current MoonPay configuration from the environment.
 *
 * Read on each call (rather than cached at import time) so tests and deploys
 * can set the variables after the module is first loaded.
 *
 * @returns {{apiKey: string|undefined, secretKey: string|undefined,
 *   webhookKey: string|undefined, widgetBaseUrl: string,
 *   defaultCryptoCode: string}} Resolved config.
 */
export const getMoonpayConfig = () => {
  const apiKey = process.env.MOONPAY_API_KEY;
  // A live publishable key is prefixed "pk_live_"; anything else (or unset)
  // uses the sandbox widget host so test keys never point at production.
  const isLive = typeof apiKey === "string" && apiKey.startsWith("pk_live_");
  const widgetBaseUrl =
    process.env.MOONPAY_WIDGET_URL ||
    (isLive ? DEFAULT_LIVE_WIDGET_URL : DEFAULT_SANDBOX_WIDGET_URL);

  return {
    apiKey,
    secretKey: process.env.MOONPAY_SECRET_KEY,
    webhookKey: process.env.MOONPAY_WEBHOOK_KEY || process.env.MOONPAY_SECRET_KEY,
    widgetBaseUrl,
    defaultCryptoCode:
      process.env.MOONPAY_DEFAULT_CRYPTO_CODE || DEFAULT_CRYPTO_CODE,
  };
};

/**
 * Whether the on-ramp is usable (both the publishable key and signing secret
 * are present). Used by the controller to return 503 when unconfigured.
 *
 * @returns {boolean} True when widget URLs can be signed and served.
 */
export const isOnrampConfigured = () => {
  const { apiKey, secretKey } = getMoonpayConfig();
  return Boolean(apiKey && secretKey);
};

/**
 * Build a signed MoonPay buy-widget URL with the user's wallet pre-filled.
 *
 * The MoonPay `signature` is a base64-encoded HMAC-SHA256 of the full URL query
 * string (including the leading "?") using the secret key. It is appended as
 * the final `signature` query parameter.
 *
 * @param {object} params
 * @param {string} params.walletAddress   Stellar public key to deliver crypto to.
 * @param {string} [params.cryptoCurrency] Crypto currency code (default from env).
 * @param {string} [params.baseCurrencyCode] Fiat currency code (e.g. "usd").
 * @param {number|string} [params.baseCurrencyAmount] Fiat amount to prefill.
 * @param {string} [params.externalTransactionId] Our transaction id, echoed back
 *   in webhooks so a provider event can be linked to the originating record.
 * @param {string} [params.email] Customer email to prefill in the widget.
 * @param {string} [params.redirectUrl] URL MoonPay redirects to on completion.
 * @returns {{url: string, cryptoCurrency: string}} Signed widget URL and the
 *   resolved crypto currency code.
 * @throws {Error} With `statusCode` set when unconfigured or inputs are invalid.
 */
export const buildWidgetUrl = ({
  walletAddress,
  cryptoCurrency,
  baseCurrencyCode,
  baseCurrencyAmount,
  externalTransactionId,
  email,
  redirectUrl,
} = {}) => {
  const { apiKey, secretKey, widgetBaseUrl, defaultCryptoCode } =
    getMoonpayConfig();

  if (!apiKey || !secretKey) {
    const error = new Error(
      "Fiat on-ramp is not available right now. Please try again later."
    );
    error.statusCode = 503;
    throw error;
  }
  if (!walletAddress || !isValidPublicKey(walletAddress)) {
    const error = new Error("Invalid Stellar wallet address");
    error.statusCode = 400;
    throw error;
  }

  const currencyCode = (cryptoCurrency || defaultCryptoCode).toLowerCase();

  const url = new URL(widgetBaseUrl);
  url.searchParams.append("apiKey", apiKey);
  url.searchParams.append("currencyCode", currencyCode);
  url.searchParams.append("walletAddress", walletAddress);

  if (baseCurrencyCode) {
    url.searchParams.append("baseCurrencyCode", baseCurrencyCode.toLowerCase());
  }
  if (baseCurrencyAmount !== undefined && baseCurrencyAmount !== null) {
    url.searchParams.append("baseCurrencyAmount", String(baseCurrencyAmount));
  }
  if (externalTransactionId) {
    url.searchParams.append("externalTransactionId", String(externalTransactionId));
  }
  if (email) {
    url.searchParams.append("email", email);
  }
  if (redirectUrl) {
    url.searchParams.append("redirectURL", redirectUrl);
  }

  // MoonPay signs the query string including the leading "?".
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(url.search)
    .digest("base64");
  url.searchParams.append("signature", signature);

  return { url: url.toString(), cryptoCurrency: currencyCode };
};

/**
 * Constant-time comparison of two signature strings of possibly differing
 * length (returns false instead of throwing on a length mismatch).
 *
 * @param {string} a First value.
 * @param {string} b Second value.
 * @returns {boolean} True when equal.
 */
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Verify a MoonPay webhook signature against the raw request body.
 *
 * MoonPay sends the `Moonpay-Signature-V2` header formatted as
 * `t=<timestamp>,s=<hexSignature>`, where the signed payload is
 * `<timestamp>.<rawBody>` HMAC-SHA256 hex-digested with the webhook key. A bare
 * hex signature (HMAC of the raw body alone) is also accepted as a fallback.
 *
 * @param {Buffer|string} rawBody      Exact bytes of the request body.
 * @param {string} signatureHeader     Value of the signature header.
 * @returns {boolean} True when the signature is valid and the webhook key is set.
 */
export const verifyWebhookSignature = (rawBody, signatureHeader) => {
  const { webhookKey } = getMoonpayConfig();
  if (!webhookKey || !signatureHeader || rawBody === undefined || rawBody === null) {
    return false;
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);

  // Parse the "t=...,s=..." structured header when present.
  let timestamp;
  let signature;
  for (const part of String(signatureHeader).split(",")) {
    const [key, value] = part.split("=");
    if (key && value !== undefined) {
      const trimmedKey = key.trim();
      if (trimmedKey === "t") timestamp = value.trim();
      else if (trimmedKey === "s") signature = value.trim();
    }
  }

  if (timestamp && signature) {
    const expected = crypto
      .createHmac("sha256", webhookKey)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    return safeEqual(expected, signature);
  }

  // Fallback: header is a bare signature over the raw body.
  const bare = String(signatureHeader).trim();
  const expectedBody = crypto
    .createHmac("sha256", webhookKey)
    .update(payload)
    .digest("hex");
  return safeEqual(expectedBody, bare);
};

/**
 * Map a raw MoonPay transaction status to an internal ONRAMP_STATUS.
 *
 * MoonPay states: `waitingPayment`, `pending`, `waitingAuthorization`,
 * `completed`, `failed`.
 *
 * @param {string} providerStatus Raw provider status.
 * @returns {string} One of the internal ONRAMP_STATUSES values.
 */
export const mapProviderStatus = (providerStatus) => {
  switch (providerStatus) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "waitingPayment":
    case "pending":
    case "waitingAuthorization":
      return "pending";
    default:
      logger.warn(`Unknown MoonPay on-ramp status: ${providerStatus}`);
      return "pending";
  }
};
