// services/stellar/multisigService.js
// Multi-signature helpers. All Horizon access and the network passphrase are
// injected via `deps` so the logic is testable without network access.
// Secret keys are never handled here: only public keys and signatures.
import * as StellarSdk from "@stellar/stellar-sdk";

const MAX_WEIGHT = 255;

const assertKey = (key, label) => {
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(key)) {
    throw new Error(`Invalid ${label}`);
  }
};

const assertWeight = (n, label) => {
  if (!Number.isInteger(n) || n < 0 || n > MAX_WEIGHT) {
    throw new Error(`${label} must be an integer between 0 and ${MAX_WEIGHT}`);
  }
};

const buildUnsigned = async ({ accountId, operations, deps }) => {
  assertKey(accountId, "account id");
  const loaded = await deps.loadAccount(accountId);
  const account = new StellarSdk.Account(accountId, loaded.sequence);
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: String(deps.baseFee ?? StellarSdk.BASE_FEE),
    networkPassphrase: deps.networkPassphrase,
  });
  operations.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(deps.timeoutSeconds ?? 86400).build();
  return { xdr: tx.toXDR(), hash: tx.hash().toString("hex") };
};

export const buildAddSignerXdr = async ({ accountId, signerPublicKey, weight, deps }) => {
  assertKey(signerPublicKey, "signer public key");
  assertWeight(weight, "weight");
  if (weight < 1) throw new Error("weight must be at least 1 when adding a signer");
  return buildUnsigned({
    accountId,
    deps,
    operations: [
      StellarSdk.Operation.setOptions({
        signer: { ed25519PublicKey: signerPublicKey, weight },
      }),
    ],
  });
};

// A signer is removed by setting its weight to 0.
export const buildRemoveSignerXdr = async ({ accountId, signerPublicKey, deps }) => {
  assertKey(signerPublicKey, "signer public key");
  return buildUnsigned({
    accountId,
    deps,
    operations: [
      StellarSdk.Operation.setOptions({
        signer: { ed25519PublicKey: signerPublicKey, weight: 0 },
      }),
    ],
  });
};

export const buildThresholdsXdr = async ({
  accountId,
  masterWeight,
  lowThreshold,
  medThreshold,
  highThreshold,
  deps,
}) => {
  const fields = { masterWeight, lowThreshold, medThreshold, highThreshold };
  const opts = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    assertWeight(v, k);
    opts[k] = v;
  }
  if (Object.keys(opts).length === 0) {
    throw new Error("At least one threshold or masterWeight is required");
  }
  return buildUnsigned({
    accountId,
    deps,
    operations: [StellarSdk.Operation.setOptions(opts)],
  });
};

const parseTx = (xdr, deps) => {
  try {
    return StellarSdk.TransactionBuilder.fromXDR(xdr, deps.networkPassphrase);
  } catch {
    throw new Error("Invalid transaction XDR");
  }
};

// Highest threshold category required by the operations (setOptions that
// touch signers/thresholds, and account merges, need "high").
const requiredThreshold = (tx, thresholds) => {
  const HIGH = new Set(["accountMerge"]);
  let level = "low";
  const rank = { low: 0, med: 1, high: 2 };
  for (const op of tx.operations) {
    let cat = "med";
    if (op.type === "allowTrust" || op.type === "bumpSequence") cat = "low";
    if (HIGH.has(op.type)) cat = "high";
    if (
      op.type === "setOptions" &&
      (op.signer || op.masterWeight !== undefined || op.lowThreshold !== undefined ||
        op.medThreshold !== undefined || op.highThreshold !== undefined)
    ) {
      cat = "high";
    }
    if (rank[cat] > rank[level]) level = cat;
  }
  return thresholds[level];
};

const totalWeight = (pending) =>
  pending.signatures.reduce((sum, s) => sum + s.weight, 0);

/**
 * Register an unsigned (or partially signed) transaction as pending.
 * Snapshots the account's signers and the threshold the tx needs.
 */
export const createPendingTransaction = async ({
  accountId,
  xdr,
  createdBy,
  description,
  deps,
}) => {
  const tx = parseTx(xdr, deps);
  if (tx.source !== accountId) {
    throw new Error("Transaction source does not match account");
  }
  const account = await deps.loadAccountDetails(accountId);
  const signerWeights = {};
  for (const s of account.signers) signerWeights[s.key] = s.weight;
  const threshold = requiredThreshold(tx, {
    low: account.thresholds.low_threshold,
    med: account.thresholds.med_threshold,
    high: account.thresholds.high_threshold,
  });
  return deps.model.create({
    accountId,
    createdBy,
    description,
    xdr: tx.toXDR(),
    txHash: tx.hash().toString("hex"),
    threshold,
    signerWeights,
    signatures: [],
    status: "pending",
  });
};

/**
 * Verify the signatures on `signedXdr` against the stored signer set and
 * merge new ones into the pending record.
 */
export const addSignatures = async ({ pending, signedXdr, deps }) => {
  if (pending.status === "submitted") throw new Error("Transaction already submitted");
  const signed = parseTx(signedXdr, deps);
  const hash = signed.hash();
  if (hash.toString("hex") !== pending.txHash) {
    throw new Error("Signed transaction does not match the pending transaction");
  }
  const weights =
    pending.signerWeights instanceof Map
      ? Object.fromEntries(pending.signerWeights)
      : pending.signerWeights;
  const known = new Set(pending.signatures.map((s) => s.publicKey));
  let added = 0;
  for (const sig of signed.signatures) {
    for (const [publicKey, weight] of Object.entries(weights)) {
      if (known.has(publicKey) || weight < 1) continue;
      let ok = false;
      try {
        ok = StellarSdk.Keypair.fromPublicKey(publicKey).verify(hash, sig.signature());
      } catch {
        ok = false;
      }
      if (ok) {
        pending.signatures.push({
          publicKey,
          signature: sig.signature().toString("base64"),
          weight,
        });
        known.add(publicKey);
        added += 1;
        break;
      }
    }
  }
  if (added === 0) throw new Error("No new valid signatures from authorized signers");
  pending.status = totalWeight(pending) >= pending.threshold ? "ready" : "pending";
  await pending.save();
  return { added, totalWeight: totalWeight(pending), threshold: pending.threshold };
};

/** Submit once the collected signature weight meets the threshold. */
export const submitPending = async ({ pending, deps }) => {
  if (pending.status === "submitted") throw new Error("Transaction already submitted");
  if (totalWeight(pending) < pending.threshold) {
    throw new Error("Signature threshold not met");
  }
  const tx = parseTx(pending.xdr, deps);
  for (const s of pending.signatures) {
    tx.addSignature(s.publicKey, s.signature);
  }
  try {
    const result = await deps.submit(tx.toXDR());
    pending.status = "submitted";
    pending.submittedHash = result.hash;
    pending.ledger = result.ledger;
    await pending.save();
    return result;
  } catch (err) {
    pending.status = "failed";
    pending.error = String(err.message).slice(0, 500);
    await pending.save();
    throw err;
  }
};
