import { jest } from "@jest/globals";

const registered = new Map();
const enqueue = jest.fn().mockResolvedValue({ queued: true });
const findById = jest.fn();
const verifyPaymentOperations = jest.fn();

jest.unstable_mockModule("../src/jobs/queue.js", () => ({
  registerJob: (name, handler) => registered.set(name, handler),
  enqueue,
}));
jest.unstable_mockModule("../src/models/Transaction.js", () => ({
  default: { findById },
}));
jest.unstable_mockModule("../src/models/User.js", () => ({
  default: { findById: jest.fn(), updateOne: jest.fn() },
}));
jest.unstable_mockModule("../src/models/Course.js", () => ({
  default: { updateOne: jest.fn() },
}));
jest.unstable_mockModule("../services/emails/sendMail.js", () => ({
  sendOtpEmail: jest.fn(),
  sendReceiptEmail: jest.fn(),
}));
jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  verifyPaymentOperations,
  getExplorerUrl: (hash) => `https://explorer/${hash}`,
}));
jest.unstable_mockModule("../src/services/payoutService.js", () => ({
  recordSaleEarnings: jest.fn(),
}));

await import("../src/jobs/handlers.js");

const transaction = () => ({
  _id: { toString: () => "transaction-id" },
  type: "donation",
  status: "retrying",
  stellarTxHash: "stellar-hash",
  creatorWallet: "destination",
  amount: "10",
  save: jest.fn().mockResolvedValue(),
});

describe("verifyPaymentOnChain job", () => {
  const handler = registered.get("verifyPaymentOnChain");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps transient Horizon failures retryable", async () => {
    const record = transaction();
    findById.mockResolvedValue(record);
    verifyPaymentOperations.mockResolvedValue({
      verified: false,
      transient: true,
      reason: "Horizon timeout",
    });

    await expect(handler({ transactionId: "transaction-id" }, { attempt: 1, maxAttempts: 3 }))
      .rejects.toThrow("Horizon timeout");

    expect(record.status).toBe("retrying");
    expect(record.retryCount).toBe(1);
  });

  it("definitively fails after the final transient attempt", async () => {
    const record = transaction();
    findById.mockResolvedValue(record);
    verifyPaymentOperations.mockResolvedValue({
      verified: false,
      transient: true,
      reason: "Transaction not found on network",
    });

    await handler({ transactionId: "transaction-id" }, { attempt: 3, maxAttempts: 3 });

    expect(record.status).toBe("failed");
    expect(record.failureReason).toContain("Transaction not found");
  });

  it("confirms a verified transaction and enqueues one receipt", async () => {
    const record = transaction();
    findById.mockResolvedValue(record);
    verifyPaymentOperations.mockResolvedValue({ verified: true });

    await handler({ transactionId: "transaction-id" }, { attempt: 2, maxAttempts: 3 });

    expect(record.status).toBe("confirmed");
    expect(enqueue).toHaveBeenCalledWith(
      "generateReceipt",
      { transactionId: "transaction-id" },
      expect.objectContaining({ idempotencyKey: "receipt:stellar-hash" })
    );
  });
});
