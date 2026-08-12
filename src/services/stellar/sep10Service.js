// services/stellar/sep10Service.js
//
// SEP-10 Web Authentication (https://stellar.org/protocol/sep-10).
//
// Two responsibilities:
//   1. buildChallenge(account)  → a server-signed challenge transaction (base64 XDR)
//   2. verifyChallenge(signed)  → validates the client's signature and returns the
//                                 proven account id, so the caller can issue a JWT.
//
// The signing keypair is dedicated to auth and NEVER holds funds, so this does not
// change DeenBridge's non-custodial model for user money. The feature stays fully
// optional at boot: when SEP10_SIGNING_SECRET (or the domains) are unset, the
// endpoints report "not configured" and return 503 instead of crashing.
import { Keypair, WebAuth } from "@stellar/stellar-sdk";
import {
  server,
  networkPassphrase,
  isValidPublicKey,
} from "./stellarService.js";
import logger from "../../config/logger.js";

const CHALLENGE_TIMEOUT = Number(process.env.SEP10_CHALLENGE_TIMEOUT) || 300;
const HOME_DOMAIN = process.env.SEP10_HOME_DOMAIN || "";
const WEB_AUTH_DOMAIN = process.env.SEP10_WEB_AUTH_DOMAIN || HOME_DOMAIN;

let serverKeypair = null;
if (process.env.SEP10_SIGNING_SECRET) {
  try {
    serverKeypair = Keypair.fromSecret(process.env.SEP10_SIGNING_SECRET.trim());
    logger.info(
      `🔐 SEP-10 auth enabled — signing key ${serverKeypair
        .publicKey()
        .slice(0, 6)}… home=${HOME_DOMAIN || "(unset)"}`
    );
  } catch (err) {
    // Bad secret is a config error, not a crash: stay disabled and surface 503.
    logger.error(`SEP-10 SEP10_SIGNING_SECRET is invalid: ${err.message}`);
    serverKeypair = null;
  }
}

/**
 * True only when the feature has everything it needs to serve real challenges:
 * a valid signing keypair and the two domains that anchor the challenge.
 */
export const isSep10Configured = () =>
  Boolean(serverKeypair && HOME_DOMAIN && WEB_AUTH_DOMAIN);

/** Public signing key, or null when unconfigured (used for stellar.toml SIGNING_KEY). */
export const getSigningPublicKey = () =>
  serverKeypair ? serverKeypair.publicKey() : null;

// ── Replay protection ──────────────────────────────────────────────────────
// Challenges are single-use. We remember the hash of every challenge we accept
// until its time bound expires and reject any reuse. In-memory is sufficient for
// a single instance (the issue's stated bar); a Redis-backed store can replace
// this Map without changing the call sites.
const consumedChallenges = new Map(); // hash(hex) → expiry epoch ms

const pruneExpired = (now) => {
  for (const [hash, expiry] of consumedChallenges) {
    if (expiry <= now) consumedChallenges.delete(hash);
  }
};

/**
 * Build a SEP-10 challenge transaction for `clientAccountId`.
 * @returns {{ transaction: string, network_passphrase: string }}
 * @throws {Error} code "SEP10_NOT_CONFIGURED" | "INVALID_ACCOUNT"
 */
export const buildChallenge = (clientAccountId) => {
  if (!isSep10Configured()) {
    const err = new Error("Sign in with Stellar is not configured.");
    err.code = "SEP10_NOT_CONFIGURED";
    throw err;
  }
  if (!clientAccountId || !isValidPublicKey(clientAccountId)) {
    const err = new Error("A valid Stellar account (G…) is required.");
    err.code = "INVALID_ACCOUNT";
    throw err;
  }

  const transaction = WebAuth.buildChallengeTx(
    serverKeypair,
    clientAccountId,
    HOME_DOMAIN,
    CHALLENGE_TIMEOUT,
    networkPassphrase,
    WEB_AUTH_DOMAIN
  );

  return { transaction, network_passphrase: networkPassphrase };
};

/**
 * Verify a signed SEP-10 challenge and return the proven account id.
 *
 * `readChallengeTx` validates the server signature, time bounds, home domain and
 * the manage-data op shape. We then prove the *client* controls the account:
 *   • account exists on-chain → threshold check against its real signers/weights
 *   • account not yet created (valid per SEP-10) → master-key signer check
 * Finally we enforce single-use via the challenge hash.
 *
 * @returns {Promise<string>} the proven client account id (G…)
 * @throws {Error} code "SEP10_NOT_CONFIGURED" | "INVALID_CHALLENGE" | "CHALLENGE_REPLAYED"
 */
export const verifyChallenge = async (signedXdr, now = Date.now()) => {
  if (!isSep10Configured()) {
    const err = new Error("Sign in with Stellar is not configured.");
    err.code = "SEP10_NOT_CONFIGURED";
    throw err;
  }
  if (!signedXdr || typeof signedXdr !== "string") {
    const err = new Error("A signed challenge transaction is required.");
    err.code = "INVALID_CHALLENGE";
    throw err;
  }

  const serverAccountId = serverKeypair.publicKey();

  let tx;
  let clientAccountID;
  try {
    ({ tx, clientAccountID } = WebAuth.readChallengeTx(
      signedXdr,
      serverAccountId,
      networkPassphrase,
      HOME_DOMAIN,
      WEB_AUTH_DOMAIN
    ));
  } catch (err) {
    // Wrong server sig, expired time bounds, tampered domain, bad structure.
    const wrapped = new Error(err.message || "Invalid challenge transaction.");
    wrapped.code = "INVALID_CHALLENGE";
    throw wrapped;
  }

  // Replay guard — reject a challenge we've already consumed.
  pruneExpired(now);
  const challengeHash = tx.hash().toString("hex");
  if (consumedChallenges.has(challengeHash)) {
    const err = new Error("This challenge has already been used.");
    err.code = "CHALLENGE_REPLAYED";
    throw err;
  }

  // Does the account exist on-chain? Decides threshold vs master-key verification.
  let account = null;
  try {
    account = await server.loadAccount(clientAccountID);
  } catch {
    account = null; // Not found (or Horizon hiccup) → treat as not-yet-created.
  }

  try {
    if (account) {
      const signerSummary = account.signers.map((s) => ({
        key: s.key,
        weight: s.weight,
      }));
      const medThreshold = account.thresholds?.med_threshold || 1;
      WebAuth.verifyChallengeTxThreshold(
        signedXdr,
        serverAccountId,
        networkPassphrase,
        medThreshold,
        signerSummary,
        HOME_DOMAIN,
        WEB_AUTH_DOMAIN
      );
    } else {
      WebAuth.verifyChallengeTxSigners(
        signedXdr,
        serverAccountId,
        networkPassphrase,
        [clientAccountID],
        HOME_DOMAIN,
        WEB_AUTH_DOMAIN
      );
    }
  } catch (err) {
    const wrapped = new Error(
      err.message || "Challenge signature verification failed."
    );
    wrapped.code = "INVALID_CHALLENGE";
    throw wrapped;
  }

  // Consume the challenge until its time bound lapses.
  const maxTime = Number(tx.timeBounds?.maxTime) || 0;
  const expiry = maxTime > 0 ? maxTime * 1000 : now + CHALLENGE_TIMEOUT * 1000;
  consumedChallenges.set(challengeHash, expiry);

  return clientAccountID;
};

// Exposed for tests to assert single-use semantics deterministically.
export const _clearConsumedChallenges = () => consumedChallenges.clear();
