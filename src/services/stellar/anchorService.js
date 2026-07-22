// services/stellar/anchorService.js
import axios from "axios";
import jwt from "jsonwebtoken";
import * as StellarSdk from "@stellar/stellar-sdk";
import { APIError } from "../../middlewares/errorHandler.js";
import { getCacheOrSet, getCache, setCacheExpireAt } from "../../utils/cache.js";
import { USDC_ISSUER, networkPassphrase } from "./stellarService.js";

const anchorJwtCacheKey = (userId, homeDomain) => `anchor:jwt:${userId}:${homeDomain}`;

// SEP-24 terminal statuses: the poller stops refreshing a record once it
// reaches one of these. Every other anchor-reported status is stored and
// surfaced verbatim.
export const ANCHOR_TERMINAL_STATUSES = ["completed", "refunded", "expired", "error"];

const anchorTomlCacheTtl = () =>
  Number(process.env.ANCHOR_TOML_CACHE_TTL) || 3600;

const allowedHomeDomains = () =>
  (process.env.ANCHOR_HOME_DOMAINS || "")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);

export const isAllowedHomeDomain = (homeDomain) =>
  allowedHomeDomains().includes(homeDomain);

export const isAnchorConfigured = () => allowedHomeDomains().length > 0;

const normalizeAssetInfo = (asset) => ({
  enabled: !!asset?.enabled,
  minAmount: asset?.min_amount ?? null,
  maxAmount: asset?.max_amount ?? null,
  feeFixed: asset?.fee_fixed ?? null,
  feePercent: asset?.fee_percent ?? null,
});

/**
 * Resolve stellar.toml for an anchor, verify its USDC issuer matches the
 * platform's own USDC_ISSUER (never trust the anchor's self-reported
 * currency entry), and fetch SEP-24 /info.
 *
 * The allowlist check runs before any await, so a non-allowlisted domain
 * never reaches stellar.toml resolution or any other network call.
 */
export const getAnchorInfo = async (homeDomain) => {
  if (!isAllowedHomeDomain(homeDomain)) {
    throw new APIError(`Anchor domain '${homeDomain}' is not allowlisted`, 403);
  }

  const toml = await getCacheOrSet(
    `anchor:toml:${homeDomain}`,
    () => StellarSdk.StellarToml.Resolver.resolve(homeDomain),
    anchorTomlCacheTtl()
  );

  const transferServer = toml.TRANSFER_SERVER_SEP0024;
  const webAuthEndpoint = toml.WEB_AUTH_ENDPOINT;
  const signingKey = toml.SIGNING_KEY;

  if (!transferServer || !webAuthEndpoint || !signingKey) {
    throw new APIError(
      `Anchor '${homeDomain}' stellar.toml is missing TRANSFER_SERVER_SEP0024, WEB_AUTH_ENDPOINT, or SIGNING_KEY`,
      502
    );
  }

  const usdcCurrency = (toml.CURRENCIES || []).find((c) => c.code === "USDC");
  if (!usdcCurrency) {
    throw new APIError(
      `Anchor '${homeDomain}' does not publish a USDC currency in stellar.toml`,
      502
    );
  }
  // The anchor's self-reported currency entry is never trusted on its own -
  // its issuer must match the platform's own USDC issuer constant.
  if (usdcCurrency.issuer !== USDC_ISSUER) {
    throw new APIError(
      `Anchor '${homeDomain}' USDC issuer (${usdcCurrency.issuer}) does not match the platform's USDC issuer (${USDC_ISSUER}); refusing to trust this anchor`,
      502
    );
  }

  let sep24Info;
  try {
    const response = await axios.get(`${transferServer}/info`);
    sep24Info = response.data;
  } catch (error) {
    throw new APIError(
      `Failed to fetch /info from anchor '${homeDomain}': ${error.message}`,
      502
    );
  }

  return {
    homeDomain,
    transferServer,
    webAuthEndpoint,
    signingKey,
    currency: usdcCurrency,
    deposit: normalizeAssetInfo(sep24Info?.deposit?.USDC),
    withdraw: normalizeAssetInfo(sep24Info?.withdraw?.USDC),
  };
};

/**
 * Fetch a SEP-10 challenge transaction from the anchor and fully validate
 * it before returning anything to the caller. A challenge is only ever
 * handed back once it is confirmed to be: sequence 0, signed by the TOML's
 * SIGNING_KEY, built for our network passphrase, scoped to the requested
 * home domain, and issued for the requesting account. Any failure throws
 * and nothing is returned for the client to sign.
 */
export const fetchAndValidateChallenge = async ({ homeDomain, account }) => {
  const anchorInfo = await getAnchorInfo(homeDomain);

  let response;
  try {
    response = await axios.get(anchorInfo.webAuthEndpoint, {
      params: { account },
    });
  } catch (error) {
    throw new APIError(
      `Failed to reach '${homeDomain}' web auth endpoint: ${error.message}`,
      502
    );
  }

  const challengeXdr = response.data?.transaction;
  if (!challengeXdr || typeof challengeXdr !== "string") {
    throw new APIError(
      `Anchor '${homeDomain}' did not return a challenge transaction`,
      502
    );
  }

  const webAuthDomain = new URL(anchorInfo.webAuthEndpoint).host;

  let details;
  try {
    details = StellarSdk.WebAuth.readChallengeTx(
      challengeXdr,
      anchorInfo.signingKey,
      networkPassphrase,
      homeDomain,
      webAuthDomain
    );
  } catch (error) {
    throw new APIError(`Challenge validation failed: ${error.message}`, 502);
  }

  if (details.clientAccountID !== account) {
    throw new APIError(
      `Challenge transaction was issued for a different account than requested`,
      502
    );
  }

  return {
    challengeXdr,
    networkPassphrase,
    homeDomain,
    webAuthEndpoint: anchorInfo.webAuthEndpoint,
  };
};

/**
 * Submit a client-signed SEP-10 challenge to the anchor and return the JWT
 * it issues, along with the JWT's own expiry claim. The JWT's signature is
 * the anchor's, not ours - we don't hold a key to verify it and don't need
 * to; we only decode it to read `exp` so the token can be cached with a
 * matching TTL.
 */
export const submitChallengeResponse = async ({ homeDomain, signedXdr }) => {
  const anchorInfo = await getAnchorInfo(homeDomain);

  let response;
  try {
    response = await axios.post(anchorInfo.webAuthEndpoint, {
      transaction: signedXdr,
    });
  } catch (error) {
    throw new APIError(
      `Failed to submit signed challenge to '${homeDomain}': ${error.message}`,
      502
    );
  }

  const token = response.data?.token;
  if (!token || typeof token !== "string") {
    throw new APIError(`Anchor '${homeDomain}' did not return a JWT`, 502);
  }

  const decoded = jwt.decode(token);
  if (!decoded?.exp) {
    throw new APIError(
      `Anchor '${homeDomain}' returned a JWT with no expiry claim`,
      502
    );
  }

  return { token, exp: decoded.exp };
};

/**
 * Store an anchor JWT server-side, keyed by (userId, homeDomain), with its
 * Redis TTL set from the token's own `exp` claim. If Redis is unavailable
 * this silently no-ops (matching every other cache use in this codebase) -
 * the session is simply not persisted, which surfaces to the caller as
 * "no stored session" and triggers re-auth rather than a stale credential.
 */
export const storeAnchorJwt = async (userId, homeDomain, token, exp) => {
  await setCacheExpireAt(anchorJwtCacheKey(userId, homeDomain), { token }, exp);
};

/**
 * Fetch a previously stored anchor JWT. Returns null if none was stored, or
 * if it has expired (Redis drops the key once its TTL from `exp` lapses) -
 * either way the caller should treat this as "not authenticated" and prompt
 * re-auth, not as an anchor-side error.
 */
export const getStoredAnchorJwt = async (userId, homeDomain) => {
  const cached = await getCache(anchorJwtCacheKey(userId, homeDomain));
  return cached?.token || null;
};

/**
 * Start a SEP-24 interactive deposit or withdrawal. Uses multipart/form-data
 * as required by the SEP-24 spec for these endpoints.
 */
export const startInteractiveFlow = async ({
  transferServer,
  jwtToken,
  kind,
  account,
  assetCode = "USDC",
}) => {
  const form = new FormData();
  form.append("asset_code", assetCode);
  form.append("account", account);

  let response;
  try {
    response = await axios.post(
      `${transferServer}/transactions/${kind}/interactive`,
      form,
      { headers: { Authorization: `Bearer ${jwtToken}` } }
    );
  } catch (error) {
    throw new APIError(
      `Failed to start ${kind} with the anchor: ${error.message}`,
      502
    );
  }

  const { url, id } = response.data || {};
  if (!url || !id) {
    throw new APIError(
      `Anchor did not return an interactive URL and transaction id`,
      502
    );
  }

  return { url, id };
};

/**
 * Fetch the current status of a single SEP-24 transaction from the anchor.
 */
export const fetchAnchorTransactionStatus = async ({
  transferServer,
  jwtToken,
  anchorTransactionId,
}) => {
  let response;
  try {
    response = await axios.get(`${transferServer}/transaction`, {
      params: { id: anchorTransactionId },
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
  } catch (error) {
    throw new APIError(
      `Failed to fetch transaction status from the anchor: ${error.message}`,
      502
    );
  }

  const tx = response.data?.transaction;
  if (!tx) {
    throw new APIError(`Anchor did not return a transaction record`, 502);
  }

  return tx;
};

/**
 * Map a raw SEP-24 transaction record onto AnchorTransaction fields. Status
 * is passed through verbatim - the frontend needs the full anchor-reported
 * vocabulary, not a normalized subset. Only defined fields are included, so
 * callers can safely Object.assign this onto an existing record without
 * clobbering previously known values with undefined.
 */
export const mapAnchorTransactionFields = (tx) => {
  const fields = {
    status: tx.status,
    amountIn: tx.amount_in,
    amountOut: tx.amount_out,
    amountFee: tx.amount_fee,
    stellarTxHash: tx.stellar_transaction_id,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );
};
