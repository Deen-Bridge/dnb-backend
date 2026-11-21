// services/stellar/paymentReference.js
//
// Canonical purchase references (issue #695).
//
// Every checkout mints a random reference that is stored on its Transaction
// under a unique index and carried on-chain in the text memo. Reconciliation
// resolves a payment by an exact, indexed lookup on that reference instead of
// guessing from a fragment of the item id.
//
// Stellar text memos are capped at 28 bytes, so the memo layout is:
//
//   DNB-B-<22 chars>   book purchase
//   DNB-C-<22 chars>   course purchase
//
// The 22 characters are Crockford base32 (no I, L, O, U), giving 110 bits of
// randomness: collisions are not a practical concern, and the unique index on
// Transaction.paymentReference turns the theoretical case into a hard error
// instead of a silent mis-attribution.
//
// Legacy memos (DNB-BOOK-<8 hex> / DNB-COURSE-<8 hex>) are still recognised so
// in-flight checkouts created before the rollout can settle, but they are only
// ever resolved against the exact memo stored on a pending Transaction and
// fail closed on zero or multiple matches.

import { randomBytes } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const PAYMENT_REFERENCE_LENGTH = 22;
export const STELLAR_TEXT_MEMO_MAX_BYTES = 28;

export const DONATION_MEMO = "DNB-SADAQAH";

const ITEM_TYPE_TO_TAG = Object.freeze({ book: "B", course: "C" });
const TAG_TO_ITEM_TYPE = Object.freeze({ B: "book", C: "course" });

const CANONICAL_MEMO_RE = new RegExp(
  `^DNB-([BC])-([${CROCKFORD_ALPHABET}]{${PAYMENT_REFERENCE_LENGTH}})$`
);
const CANONICAL_PREFIX_RE = /^DNB-[BC]-/;

const LEGACY_MEMO_RE = /^DNB-(BOOK|COURSE)-([a-f0-9]{8})$/i;
const LEGACY_PREFIX_RE = /^DNB-(BOOK|COURSE)-/i;

export const PAYMENT_REFERENCE_RE = new RegExp(
  `^[${CROCKFORD_ALPHABET}]{${PAYMENT_REFERENCE_LENGTH}}$`
);

/**
 * Mint a new random payment reference.
 *
 * Each output character consumes one random byte masked to 5 bits. 256 is a
 * multiple of 32, so the mask introduces no modulo bias.
 *
 * @returns {string} 22-character Crockford base32 reference
 */
export const generatePaymentReference = () => {
  const bytes = randomBytes(PAYMENT_REFERENCE_LENGTH);
  let reference = "";
  for (const byte of bytes) {
    reference += CROCKFORD_ALPHABET[byte & 0x1f];
  }
  return reference;
};

/**
 * Build the on-chain text memo for a purchase.
 *
 * @param {"book"|"course"} itemType
 * @param {string} reference - value from generatePaymentReference()
 * @returns {string} memo of exactly 28 bytes
 * @throws {Error} when the item type or reference is invalid
 */
export const buildPurchaseMemo = (itemType, reference) => {
  const tag = ITEM_TYPE_TO_TAG[itemType];
  if (!tag) {
    throw new Error(`Cannot build purchase memo for item type "${itemType}"`);
  }
  if (typeof reference !== "string" || !PAYMENT_REFERENCE_RE.test(reference)) {
    throw new Error("Cannot build purchase memo from a malformed payment reference");
  }
  return `DNB-${tag}-${reference}`;
};

/**
 * Classify a memo read from Horizon.
 *
 * Kinds:
 *   - "none"       no memo, or a memo that is not ours (left for manual review)
 *   - "donation"   the sadaqah donation memo
 *   - "canonical"  { itemType, reference }
 *   - "legacy"     { itemType, memo } — pre-#695 suffix memo
 *   - "malformed"  uses one of our purchase prefixes but fails strict parsing
 *
 * Canonical references are case-sensitive on purpose: we always emit upper
 * case, so a lower-cased memo was not produced by this platform.
 *
 * @param {unknown} memo
 * @returns {{kind: string, itemType?: string, reference?: string, memo?: string}}
 */
export const parsePaymentMemo = (memo) => {
  if (typeof memo !== "string" || memo.length === 0) {
    return { kind: "none" };
  }
  if (memo === DONATION_MEMO) {
    return { kind: "donation" };
  }

  const canonical = CANONICAL_MEMO_RE.exec(memo);
  if (canonical) {
    return {
      kind: "canonical",
      itemType: TAG_TO_ITEM_TYPE[canonical[1]],
      reference: canonical[2],
    };
  }

  const legacy = LEGACY_MEMO_RE.exec(memo);
  if (legacy) {
    // Legacy rows were written with the original-case item id suffix
    // (Mongo ObjectIds stringify lower-case), so normalise to that form for
    // the exact-match lookup.
    const itemType = legacy[1].toLowerCase();
    return {
      kind: "legacy",
      itemType,
      memo: `DNB-${itemType.toUpperCase()}-${legacy[2].toLowerCase()}`,
    };
  }

  if (CANONICAL_PREFIX_RE.test(memo) || LEGACY_PREFIX_RE.test(memo)) {
    return { kind: "malformed" };
  }

  return { kind: "none" };
};
