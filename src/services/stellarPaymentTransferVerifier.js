/**
 * Verify Stellar transaction success, destination, asset, and amount before completing payment (#477).
 */

export class StellarPaymentVerifier {
  constructor() {
    this.completedTxHashes = new Map();
  }

  verifyAndCompletePayment({
    intentId,
    expectedDestination,
    expectedAssetCode,
    expectedAssetIssuer,
    expectedAmount,
    expectedMemo,
    txRecord,
    verifiedAt = new Date().toISOString(),
  }) {
    if (!txRecord || !txRecord.hash) {
      return { status: "rejected", reason: "MISSING_TRANSACTION_RECORD" };
    }
    const txHash = String(txRecord.hash).trim().toLowerCase();

    if (this.completedTxHashes.has(txHash)) {
      const prior = this.completedTxHashes.get(txHash);
      if (prior.intentId === intentId) {
        return { status: "completed", idempotentReplay: true, audit: prior };
      }
      return { status: "rejected", reason: "DUPLICATE_TRANSACTION_HASH" };
    }

    if (txRecord.successful !== true || !txRecord.ledger) {
      return { status: "rejected", reason: "TRANSACTION_NOT_SUCCESSFUL" };
    }

    if (expectedMemo && String(txRecord.memo || "").trim() !== String(expectedMemo).trim()) {
      return { status: "rejected", reason: "MEMO_MISMATCH" };
    }

    const op = (txRecord.operations || []).find((o) => o.type === "payment");
    if (!op) {
      return { status: "rejected", reason: "NO_PAYMENT_OPERATION" };
    }
    if (op.to !== expectedDestination) {
      return { status: "rejected", reason: "WRONG_DESTINATION" };
    }
    if (op.asset_code !== expectedAssetCode || op.asset_issuer !== expectedAssetIssuer) {
      return { status: "rejected", reason: "WRONG_ASSET_OR_ISSUER" };
    }
    if (Number(op.amount) < Number(expectedAmount)) {
      return { status: "rejected", reason: "INSUFFICIENT_AMOUNT" };
    }

    const audit = {
      intentId,
      txHash,
      ledger: txRecord.ledger,
      verifiedAt,
      destination: op.to,
      amount: op.amount,
    };
    this.completedTxHashes.set(txHash, audit);
    return { status: "completed", idempotentReplay: false, audit };
  }
}
