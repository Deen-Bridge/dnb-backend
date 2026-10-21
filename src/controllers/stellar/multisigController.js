// controllers/stellar/multisigController.js
import MultisigTransaction from "../../models/MultisigTransaction.js";
import logger from "../../config/logger.js";
import {
  server,
  networkPassphrase,
  submitTransaction,
} from "../../services/stellar/stellarService.js";
import * as multisig from "../../services/stellar/multisigService.js";

const loadAccountDetails = (id) => server.loadAccount(id);

const deps = {
  networkPassphrase,
  loadAccount: loadAccountDetails,
  loadAccountDetails,
  submit: submitTransaction,
  model: MultisigTransaction,
};

const KNOWN_ERRORS = [
  "Invalid", "must be", "At least one", "does not match", "already submitted",
  "threshold not met", "No new valid", "at least 1",
];
const fail = (res, error, fallback) => {
  const known = KNOWN_ERRORS.some((m) => error.message?.includes(m));
  if (!known) logger.error(`${fallback}:`, error);
  return res
    .status(known ? 400 : 500)
    .json({ success: false, message: known ? error.message : fallback });
};

// The caller's connected wallet must be a signer on the account.
const requireSigner = async (req, accountId) => {
  const key = req.user?.stellarWallet?.publicKey;
  if (!key) return false;
  const account = await deps.loadAccountDetails(accountId);
  return account.signers.some((s) => s.key === key && s.weight > 0);
};

const loadAuthorized = async (req, res) => {
  const pending = await MultisigTransaction.findById(req.params.id);
  if (!pending) {
    res.status(404).json({ success: false, message: "Transaction not found" });
    return null;
  }
  const key = req.user?.stellarWallet?.publicKey;
  const w = pending.signerWeights.get(key);
  if (!key || !(w > 0)) {
    res.status(403).json({ success: false, message: "Not a signer on this account" });
    return null;
  }
  return pending;
};

const unsignedHandler = (build, label) => async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!(await requireSigner(req, accountId))) {
      return res.status(403).json({ success: false, message: "Not a signer on this account" });
    }
    const result = await build(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    fail(res, error, label);
  }
};

export const addSigner = unsignedHandler(
  (b) => multisig.buildAddSignerXdr({ ...b, deps }),
  "Failed to build add-signer transaction"
);
export const removeSigner = unsignedHandler(
  (b) => multisig.buildRemoveSignerXdr({ ...b, deps }),
  "Failed to build remove-signer transaction"
);
export const setThresholds = unsignedHandler(
  (b) => multisig.buildThresholdsXdr({ ...b, deps }),
  "Failed to build threshold transaction"
);

export const createPending = async (req, res) => {
  try {
    const { accountId, xdr, description } = req.body;
    if (!(await requireSigner(req, accountId))) {
      return res.status(403).json({ success: false, message: "Not a signer on this account" });
    }
    const pending = await multisig.createPendingTransaction({
      accountId, xdr, description, createdBy: req.user._id, deps,
    });
    res.status(201).json({ success: true, data: pending });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Transaction already registered" });
    }
    fail(res, error, "Failed to create pending transaction");
  }
};

export const listPending = async (req, res) => {
  try {
    const key = req.user?.stellarWallet?.publicKey;
    if (!key) return res.json({ success: true, data: [] });
    const filter = { [`signerWeights.${key}`]: { $gt: 0 } };
    filter.status = req.query.status === "all" ? { $ne: null } : { $in: ["pending", "ready"] };
    const items = await MultisigTransaction.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, data: items });
  } catch (error) {
    fail(res, error, "Failed to list pending transactions");
  }
};

export const getPending = async (req, res) => {
  try {
    const pending = await loadAuthorized(req, res);
    if (pending) res.json({ success: true, data: pending });
  } catch (error) {
    fail(res, error, "Failed to fetch transaction");
  }
};

export const signPending = async (req, res) => {
  try {
    const pending = await loadAuthorized(req, res);
    if (!pending) return;
    const result = await multisig.addSignatures({
      pending, signedXdr: req.body.signedXdr, deps,
    });
    res.json({ success: true, data: { ...result, status: pending.status } });
  } catch (error) {
    fail(res, error, "Failed to add signature");
  }
};

export const submitPending = async (req, res) => {
  try {
    const pending = await loadAuthorized(req, res);
    if (!pending) return;
    const result = await multisig.submitPending({ pending, deps });
    res.json({ success: true, data: result });
  } catch (error) {
    fail(res, error, "Failed to submit transaction");
  }
};
