// services/stellar/feeSponsorService.js
//
// Fee-bump sponsorship (#30). The platform can pay a user's Stellar network
// fee by wrapping the user-signed inner transaction in a fee-bump transaction
// signed by a dedicated, low-balance "fee-source" account. The user still
// signs (and only signs) their own payment operations; the sponsor key only
// ever signs the fee-bump wrapper and can never move user funds.
//
// Because the server signs on behalf of the platform, this path is guarded by:
//   1. a reject-by-default STRUCTURAL WHITELIST — the user's inner transaction
//      must match, operation-for-operation, the pending Transaction row the
//      server already built (see validateInnerTransaction); and
//   2. durable SPEND CAPS — per-transaction, per-UTC-day total, and per-user
//      per-day (see SponsorshipSpend + checkSpendCaps).
//
// Everything here is a no-op unless FEE_SPONSOR_ENABLED=true; with the flag off
// the caller never reaches this module and the base payment/donation flow is
// byte-for-byte unchanged.
import * as StellarSdk from "@stellar/stellar-sdk";
import logger from "../../config/logger.js";
import SponsorshipSpend from "../../models/SponsorshipSpend.js";
import {
  toStroops,
  resolveAsset,
  getAccountBalance,
  networkPassphrase,
} from "./stellarService.js";

// StellarSdk's minimum fee-bump base fee (per operation), in stroops.
const MIN_BASE_FEE_STROOPS = Number(StellarSdk.BASE_FEE); // 100

// Sensible defaults applied when a numeric cap env var is unset or invalid.
// The master switch (FEE_SPONSOR_ENABLED) and the secret have no defaults.
export const FEE_SPONSOR_DEFAULTS = Object.freeze({
  maxFeeStroops: 1_000_000, // 0.1 XLM per-transaction fee ceiling
  dailyCapStroops: 100_000_000, // 10 XLM total per UTC day
  perUserDailyLimit: 10, // sponsored transactions per user per UTC day
});

/**
 * A sponsorship-specific failure. These MUST NOT mark the user's Transaction
 * `failed`: the user can always retry the submit without sponsorship and pay
 * their own fee. `httpStatus` is a distinct non-fatal 4xx (or 503 for a
 * server-side misconfiguration) and `retryUnsponsored` signals the client to
 * fall back to the normal flow.
 */
export class SponsorshipError extends Error {
  constructor(code, message, { httpStatus = 422 } = {}) {
    super(message);
    this.name = "SponsorshipError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryUnsponsored = true;
  }
}

// ── Config ──────────────────────────────────────────────────────────────────

const parsePositiveInt = (value, fallback) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
};

export const isFeeSponsorEnabled = () =>
  process.env.FEE_SPONSOR_ENABLED === "true";

/**
 * Resolve the sponsorship config from the environment. Read at call time so a
 * deploy can tune caps without a code change; the numeric caps fall back to
 * FEE_SPONSOR_DEFAULTS when unset/invalid.
 */
export const getFeeSponsorConfig = () => ({
  enabled: isFeeSponsorEnabled(),
  maxFeeStroops: parsePositiveInt(
    process.env.FEE_SPONSOR_MAX_FEE_STROOPS,
    FEE_SPONSOR_DEFAULTS.maxFeeStroops
  ),
  dailyCapStroops: parsePositiveInt(
    process.env.FEE_SPONSOR_DAILY_CAP_STROOPS,
    FEE_SPONSOR_DEFAULTS.dailyCapStroops
  ),
  perUserDailyLimit: parsePositiveInt(
    process.env.FEE_SPONSOR_PER_USER_DAILY_LIMIT,
    FEE_SPONSOR_DEFAULTS.perUserDailyLimit
  ),
});

// The sponsor secret is read from env and parsed into a Keypair once, then
// cached by its secret value. It is never logged and never returned over HTTP.
let cachedKeypair = null;
let cachedSecret = null;

/**
 * Parse the sponsor secret into a Keypair, caching the result. Throws a
 * SponsorshipError (503) when the secret is missing or invalid so the caller
 * can surface a non-fatal "retry unsponsored" without leaking the secret.
 */
export const getFeeSponsorKeypair = () => {
  const secret = process.env.FEE_SPONSOR_SECRET;
  if (!secret) {
    throw new SponsorshipError(
      "sponsor_misconfigured",
      "Fee sponsor secret is not configured",
      { httpStatus: 503 }
    );
  }
  if (cachedSecret === secret && cachedKeypair) return cachedKeypair;
  try {
    cachedKeypair = StellarSdk.Keypair.fromSecret(secret);
    cachedSecret = secret;
    return cachedKeypair;
  } catch {
    throw new SponsorshipError(
      "sponsor_misconfigured",
      "Fee sponsor secret is invalid",
      { httpStatus: 503 }
    );
  }
};

/** Public key of the sponsor account, or null if not configured/invalid. */
export const getFeeSponsorPublicKey = () => {
  try {
    return getFeeSponsorKeypair().publicKey();
  } catch {
    return null;
  }
};

/**
 * Boot-time validation: when FEE_SPONSOR_ENABLED=true, the secret must be a
 * valid Stellar secret key. Returns { ok } / { ok:false, message } so the
 * caller (validateEnv) can fail fast with a clear message. A no-op when the
 * flag is off.
 */
export const validateFeeSponsorBootConfig = () => {
  if (!isFeeSponsorEnabled()) return { ok: true };
  const secret = process.env.FEE_SPONSOR_SECRET;
  if (!secret) {
    return {
      ok: false,
      message:
        "FEE_SPONSOR_ENABLED=true but FEE_SPONSOR_SECRET is not set. Provide the dedicated fee-source secret or disable sponsorship.",
    };
  }
  try {
    StellarSdk.Keypair.fromSecret(secret);
  } catch {
    return {
      ok: false,
      message:
        "FEE_SPONSOR_SECRET is not a valid Stellar secret key (expected an S... seed).",
    };
  }
  return { ok: true };
};

// ── Structural whitelist ─────────────────────────────────────────────────────

/** UTC calendar day (YYYY-MM-DD) used to key daily spend accounting. */
export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

const assetsEqual = (a, b) => {
  if (!a || !b) return false;
  if (a.isNative() || b.isNative()) return a.isNative() && b.isNative();
  return a.getCode() === b.getCode() && a.getIssuer() === b.getIssuer();
};

const extractTextMemo = (memo) => {
  if (!memo) return null;
  const type = memo.type ?? memo._type;
  if (type !== "text") return null;
  const value = memo.value ?? memo._value;
  if (value == null) return null;
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
};

/**
 * The settlement asset for a row. Donations and purchases both settle in
 * `row.currency` (defaulting to USDC for legacy rows with none set).
 */
const settlementAssetFor = (row) => resolveAsset(row.currency || "USDC");

/**
 * Build the exact, ordered set of payment operations the inner transaction is
 * allowed to contain, derived entirely from the server-persisted row:
 *   - a fee split → [creator op, platform op] (order matches buildPaymentTransaction);
 *   - otherwise   → [single settlement op] (direct purchase or donation).
 * Amounts are compared in stroops.
 */
export const buildExpectedOperations = (row) => {
  const asset = settlementAssetFor(row);
  if (row.platformFee && row.platformFee.platformAmount) {
    return [
      {
        destination: row.creatorWallet,
        amountStroops: toStroops(row.platformFee.creatorAmount),
        asset,
      },
      {
        destination: row.platformFee.platformWallet,
        amountStroops: toStroops(row.platformFee.platformAmount),
        asset,
      },
    ];
  }
  return [
    {
      destination: row.creatorWallet,
      amountStroops: toStroops(row.amount),
      asset,
    },
  ];
};

const reject = (detail) => {
  throw new SponsorshipError(
    "whitelist_rejected",
    `Structural whitelist rejected the signed transaction: ${detail}`,
    { httpStatus: 422 }
  );
};

/**
 * The structural whitelist. Reject-by-default: the inner transaction is
 * accepted ONLY if it is, operation-for-operation, exactly what the server
 * built for `row`. Enforced by allow-list (only `payment` ops in the settled
 * asset are permitted) and exact count, so any foreign/extra operation — of
 * any type, including one not yet invented — fails.
 *
 * @param {StellarSdk.Transaction} innerTx decoded user-signed inner transaction
 * @param {object} row the pending Transaction document
 * @returns {true} on success; throws SponsorshipError otherwise
 */
export const validateInnerTransaction = (innerTx, row) => {
  if (!innerTx || innerTx instanceof StellarSdk.FeeBumpTransaction) {
    reject("expected a plain inner transaction");
  }

  // Source must be the buyer/donor wallet the server recorded.
  if (innerTx.source !== row.buyerWallet) {
    reject(`source ${innerTx.source} does not match buyerWallet`);
  }

  // Memo must match exactly.
  const memoText = extractTextMemo(innerTx.memo);
  if ((row.memo ?? null) !== memoText) {
    reject("memo does not match the row");
  }

  const expected = buildExpectedOperations(row);

  // Exact operation count — rejects both extra/foreign ops and a missing op.
  if (innerTx.operations.length !== expected.length) {
    reject(
      `operation count ${innerTx.operations.length} does not equal expected ${expected.length}`
    );
  }

  // Every operation, positionally, must be a payment matching the row. The
  // server builds these in a deterministic order (creator then platform), and
  // wallets sign the exact envelope, so a positional check is the strictest
  // form and never rejects a legitimate signature.
  for (let i = 0; i < expected.length; i++) {
    const op = innerTx.operations[i];
    // Allow-list: only `payment` is permitted. changeTrust, setOptions,
    // manageData, accountMerge, createAccount, pathPayment*, or any unknown
    // future type falls through here and is rejected.
    if (op.type !== "payment") {
      reject(`operation ${i} is a non-payment "${op.type}" operation`);
    }
    if (op.destination !== expected[i].destination) {
      reject(`operation ${i} destination does not match the row`);
    }
    if (!assetsEqual(op.asset, expected[i].asset)) {
      reject(`operation ${i} asset does not match the settlement asset`);
    }
    if (toStroops(op.amount) !== expected[i].amountStroops) {
      reject(`operation ${i} amount does not match the row`);
    }
  }

  return true;
};

// ── Fee-bump wrapping ─────────────────────────────────────────────────────────

/**
 * Compute the fee-bump base fee (per operation) and the resulting total max
 * fee, clamped to the per-transaction ceiling. The fee-bump is priced over the
 * inner operations PLUS the wrapper (inner ops + 1), verified against the
 * installed @stellar/stellar-sdk. We declare the highest per-op fee the ceiling
 * allows so the sponsor tolerates fee surges up to the cap; Horizon still only
 * charges the true network fee, which is recorded as the actual spend.
 */
export const computeFeeBumpFee = (innerTx, config = getFeeSponsorConfig()) => {
  const innerOps = innerTx.operations.length;
  const units = innerOps + 1; // inner operations + fee-bump wrapper
  const innerPerOp = Math.ceil(Number(innerTx.fee) / innerOps);
  const perOpCeiling = Math.floor(config.maxFeeStroops / units);

  // The per-op fee must be at least the inner tx's per-op fee and the network
  // minimum. If the ceiling can't cover even that, the ceiling is too low to
  // sponsor this transaction at all.
  const minPerOp = Math.max(MIN_BASE_FEE_STROOPS, innerPerOp);
  if (perOpCeiling < minPerOp) {
    throw new SponsorshipError(
      "fee_ceiling_too_low",
      `Per-transaction fee ceiling ${config.maxFeeStroops} stroops is below the minimum required to fee-bump ${innerOps} operation(s)`,
      { httpStatus: 503 }
    );
  }

  const baseFeePerOp = perOpCeiling; // highest per-op fee within the ceiling
  const totalMaxFeeStroops = baseFeePerOp * units;
  return { baseFeePerOp, totalMaxFeeStroops, units };
};

/**
 * Wrap a validated inner transaction in a fee-bump signed by the sponsor key.
 * The inner transaction (and its user signature) is left untouched.
 */
export const wrapWithFeeBump = (
  innerTx,
  { keypair = getFeeSponsorKeypair(), baseFeePerOp } = {}
) => {
  const { baseFeePerOp: computed } =
    baseFeePerOp == null ? computeFeeBumpFee(innerTx) : { baseFeePerOp };
  const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    keypair,
    String(computed),
    innerTx,
    networkPassphrase
  );
  feeBump.sign(keypair);
  return feeBump;
};

// ── Spend accounting ──────────────────────────────────────────────────────────

/**
 * Read today's spend row and enforce caps BEFORE any wrapping/submission:
 *   - per-user daily count (FEE_SPONSOR_PER_USER_DAILY_LIMIT), and
 *   - per-UTC-day total stroops (FEE_SPONSOR_DAILY_CAP_STROOPS), reserving the
 *     worst-case fee for this transaction.
 * Throws a distinct non-fatal SponsorshipError (429) when a cap is hit.
 */
export const checkSpendCaps = async ({
  userId,
  estimatedFeeStroops,
  config = getFeeSponsorConfig(),
  session = null,
}) => {
  const day = utcDay();
  const query = SponsorshipSpend.findOne({ day });
  const doc = session ? await query.session(session) : await query;

  const userCount = doc?.userCounts?.get?.(String(userId)) ?? 0;
  if (userCount >= config.perUserDailyLimit) {
    throw new SponsorshipError(
      "per_user_daily_limit",
      `Per-user daily sponsorship limit (${config.perUserDailyLimit}) reached`,
      { httpStatus: 429 }
    );
  }

  const currentTotal = doc?.totalStroops ?? 0;
  if (currentTotal + estimatedFeeStroops > config.dailyCapStroops) {
    throw new SponsorshipError(
      "daily_cap_exceeded",
      `Daily sponsorship spend cap (${config.dailyCapStroops} stroops) would be exceeded`,
      { httpStatus: 429 }
    );
  }
};

/**
 * Record a successful sponsorship: atomically increment today's total spend
 * (by the actual fee charged), the global count, and the per-user count.
 * Called only AFTER the fee-bump has landed on-chain.
 */
export const recordSponsorshipSpend = async ({
  userId,
  feeStroops,
  session = null,
}) => {
  const day = utcDay();
  const amount = Number.isFinite(Number(feeStroops)) ? Number(feeStroops) : 0;
  await SponsorshipSpend.updateOne(
    { day },
    {
      $inc: {
        totalStroops: amount,
        sponsoredCount: 1,
        [`userCounts.${String(userId)}`]: 1,
      },
    },
    { upsert: true, ...(session ? { session } : {}) }
  );
};

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Refuse (non-fatally) if the sponsor account cannot cover the declared max
 * fee, so an underfunded float never causes a Stellar submit failure that
 * would mark the user's transaction `failed`. If the balance can't be read we
 * do NOT block — a genuine failure still surfaces at submit time.
 */
const assertSponsorFunded = async ({ publicKey, requiredStroops, loadBalance }) => {
  let balance;
  try {
    balance = await loadBalance(publicKey);
  } catch {
    return; // undeterminable — let submission proceed rather than false-refuse
  }
  const available = balance?.exists ? toStroops(balance.xlmBalance || "0") : 0n;
  if (!balance?.exists || available < BigInt(requiredStroops)) {
    throw new SponsorshipError(
      "sponsor_underfunded",
      "Sponsor float is insufficient to cover the network fee",
      { httpStatus: 503 }
    );
  }
};

/**
 * Validate → cap-check → float-check → wrap. Returns everything the controller
 * needs to submit the fee-bump and record the outcome. Throws SponsorshipError
 * on any guard failure (whitelist, cap, underfunded, or sponsor
 * misconfiguration) so the caller returns a distinct non-fatal 4xx and leaves
 * the row untouched.
 *
 * NOTE: caps are only READ here; the spend is recorded (with the real
 * fee_charged) via recordSponsorshipSpend after the fee-bump confirms.
 * `loadBalance` is injectable so the float pre-check is unit-testable offline.
 */
export const prepareSponsoredSubmission = async ({
  signedXdr,
  transactionRow,
  userId,
  session = null,
  loadBalance = getAccountBalance,
}) => {
  const config = getFeeSponsorConfig();
  const keypair = getFeeSponsorKeypair();

  let decoded;
  try {
    decoded = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch {
    throw new SponsorshipError(
      "whitelist_rejected",
      "Signed XDR could not be decoded",
      { httpStatus: 422 }
    );
  }

  validateInnerTransaction(decoded, transactionRow);

  const { baseFeePerOp, totalMaxFeeStroops } = computeFeeBumpFee(decoded, config);
  await checkSpendCaps({
    userId,
    estimatedFeeStroops: totalMaxFeeStroops,
    config,
    session,
  });

  await assertSponsorFunded({
    publicKey: keypair.publicKey(),
    requiredStroops: totalMaxFeeStroops,
    loadBalance,
  });

  const feeBump = wrapWithFeeBump(decoded, { keypair, baseFeePerOp });

  return {
    innerHash: decoded.hash().toString("hex"),
    outerHash: feeBump.hash().toString("hex"),
    feeBumpXdr: feeBump.toXDR(),
    maxFeeStroops: totalMaxFeeStroops,
  };
};

/**
 * Auth-protected status snapshot for ops: whether sponsorship is on, the
 * sponsor account's public key (never the secret) and live XLM float, the
 * configured caps, and today's spend. Used to top up the float before it runs
 * dry.
 */
export const getSponsorshipStatus = async () => {
  const config = getFeeSponsorConfig();
  const publicKey = getFeeSponsorPublicKey();
  const day = utcDay();
  const doc = await SponsorshipSpend.findOne({ day });
  const totalStroops = doc?.totalStroops ?? 0;

  let float = null;
  if (publicKey) {
    try {
      const balance = await getAccountBalance(publicKey);
      float = { exists: balance.exists, xlmBalance: balance.xlmBalance };
    } catch (error) {
      logger.warn(
        { err: error, sponsorAccount: publicKey },
        "Failed to read sponsor float balance"
      );
    }
  }

  return {
    enabled: config.enabled,
    sponsorAccount: publicKey, // public key only — the secret is never exposed
    caps: {
      maxFeeStroops: config.maxFeeStroops,
      dailyCapStroops: config.dailyCapStroops,
      perUserDailyLimit: config.perUserDailyLimit,
    },
    today: {
      day,
      totalStroops,
      sponsoredCount: doc?.sponsoredCount ?? 0,
      remainingStroops: Math.max(0, config.dailyCapStroops - totalStroops),
    },
    float,
  };
};
