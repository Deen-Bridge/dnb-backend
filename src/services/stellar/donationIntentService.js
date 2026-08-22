import Transaction from "../../models/Transaction.js";
import {
  isValidPublicKey,
  buildPaymentTransaction,
  buildSep7Uri,
  NETWORK,
  DONATION_WALLET_PUBLIC_KEY,
} from "./stellarService.js";

export const DONATION_MEMO = "DNB-SADAQAH";

export const validateDonationAmount = (amount) => {
  const parsedAmount = Number(amount);
  return Boolean(
    amount &&
      Number.isFinite(parsedAmount) &&
      parsedAmount > 0 &&
      /^\d+(\.\d{1,7})?$/.test(amount.toString())
  );
};

export const createDonationIntent = async ({ donorId, publicKey, amount, session, memo = DONATION_MEMO }) => {
  if (!DONATION_WALLET_PUBLIC_KEY) {
    const error = new Error("Donations are not available right now. Please try again later.");
    error.statusCode = 503;
    throw error;
  }
  if (!publicKey || !isValidPublicKey(publicKey)) {
    const error = new Error("Invalid Stellar public key");
    error.statusCode = 400;
    throw error;
  }
  if (!validateDonationAmount(amount)) {
    const error = new Error("Invalid amount. Must be a positive number with at most 7 decimal places");
    error.statusCode = 400;
    throw error;
  }

  const paymentTx = await buildPaymentTransaction({
    sourcePublicKey: publicKey,
    destinationPublicKey: DONATION_WALLET_PUBLIC_KEY,
    amount: amount.toString(),
    memo,
  });
  const sep7Uri = buildSep7Uri({
    destination: DONATION_WALLET_PUBLIC_KEY,
    amount: amount.toString(),
    memo,
  });
  const transaction = new Transaction({
    type: "donation",
    buyer: donorId,
    buyerWallet: publicKey,
    creatorWallet: DONATION_WALLET_PUBLIC_KEY,
    amount: amount.toString(),
    network: NETWORK,
    status: "pending",
    expectedHash: paymentTx.hash,
    memo,
  });
  await transaction.save({ session });
  return {
    transaction,
    transactionXdr: paymentTx.xdr,
    sep7Uri,
    networkPassphrase: paymentTx.networkPassphrase,
  };
};
