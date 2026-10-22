import { jest } from "@jest/globals";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const mockCursor = {
  findOne: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
};
const mockServer = { payments: jest.fn(), transactions: jest.fn() };
const mockReconcile = jest.fn();
const mockRecalculate = jest.fn();
const USDC_ISSUER = "GUSDCISSUER";

jest.unstable_mockModule("../src/config/logger.js", () => ({ default: mockLogger }));
jest.unstable_mockModule("../src/models/IngestionCursor.js", () => ({ default: mockCursor }));
jest.unstable_mockModule("../src/services/stellar/horizonClient.js", () => ({
  client: { endpoints: [{ server: mockServer }] },
}));
jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({ USDC_ISSUER }));
jest.unstable_mockModule("../src/services/stellar/reconciliationService.js", () => ({
  reconcilePayment: mockReconcile,
}));
jest.unstable_mockModule("../src/services/hashtagService.js", () => ({
  recalculateTrendingScores: mockRecalculate,
}));

const { startIngestionWorker, stopIngestionWorker } = await import(
  "../src/workers/paymentIngestionWorker.js"
);
const { startTrendingHashtagsJob } = await import("../src/jobs/trendingHashtagsJob.js");

const flush = () => new Promise((r) => setImmediate(r));

const buildPaymentsChain = (result) => {
  const chain = {
    forAccount: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: typeof result === "function" ? jest.fn(result) : jest.fn().mockResolvedValue(result),
  };
  mockServer.payments.mockReturnValue(chain);
  return chain;
};

describe("payment ingestion worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PLATFORM_WALLET_PUBLIC_KEY = "GPLATFORM";
    delete process.env.DONATION_WALLET_PUBLIC_KEY;
    mockCursor.findOne.mockResolvedValue({ account: "GPLATFORM", cursor: "100" });
    mockCursor.updateOne.mockResolvedValue({});
    mockServer.transactions.mockReturnValue({
      transaction: () => ({ call: async () => ({ hash: "tx" }) }),
    });
    mockReconcile.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await stopIngestionWorker();
  });

  it("reconciles USDC payments once and advances the cursor", async () => {
    const chain = buildPaymentsChain({
      records: [
        { type: "payment", asset_code: "USDC", asset_issuer: USDC_ISSUER, transaction_hash: "h1", paging_token: "101" },
        { type: "payment", asset_code: "XLM", transaction_hash: "h2", paging_token: "102" },
        { type: "payment", asset_code: "USDC", asset_issuer: "GFAKE", transaction_hash: "h3", paging_token: "103" },
      ],
    });

    await startIngestionWorker();
    await flush();

    expect(chain.cursor).toHaveBeenCalledWith("100");
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReconcile.mock.calls[0][0].transaction_hash).toBe("h1");
    expect(mockCursor.updateOne).toHaveBeenCalledWith(
      { account: "GPLATFORM" },
      { $set: expect.objectContaining({ cursor: "103" }) }
    );
  });

  it("handles an empty page without reconciling or moving the cursor", async () => {
    buildPaymentsChain({ records: [] });

    await startIngestionWorker();
    await flush();

    expect(mockReconcile).not.toHaveBeenCalled();
    const update = mockCursor.updateOne.mock.calls[0][1].$set;
    expect(update.cursor).toBeUndefined();
    expect(update.lastSyncAt).toBeInstanceOf(Date);
  });

  it("creates a cursor document for a new account", async () => {
    mockCursor.findOne.mockResolvedValue(null);
    mockCursor.create.mockResolvedValue({ account: "GPLATFORM", cursor: "" });
    const chain = buildPaymentsChain({ records: [] });

    await startIngestionWorker();
    await flush();

    expect(mockCursor.create).toHaveBeenCalledWith({ account: "GPLATFORM", cursor: "" });
    expect(chain.cursor).not.toHaveBeenCalled();
  });

  it("logs and keeps the cursor when Horizon fetch fails", async () => {
    buildPaymentsChain(async () => {
      throw new Error("horizon down");
    });

    await startIngestionWorker();
    await flush();

    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockCursor.updateOne).not.toHaveBeenCalled();
  });

  it("continues past a reconcile error and still advances the cursor", async () => {
    buildPaymentsChain({
      records: [
        { type: "payment", asset_code: "USDC", asset_issuer: USDC_ISSUER, transaction_hash: "h1", paging_token: "1" },
        { type: "path_payment_strict_receive", destination_asset_code: "USDC", destination_asset_issuer: USDC_ISSUER, transaction_hash: "h2", paging_token: "2" },
      ],
    });
    mockReconcile.mockRejectedValueOnce(new Error("boom"));

    await startIngestionWorker();
    await flush();

    expect(mockReconcile).toHaveBeenCalledTimes(2);
    expect(mockCursor.updateOne).toHaveBeenCalledWith(
      { account: "GPLATFORM" },
      { $set: expect.objectContaining({ cursor: "2" }) }
    );
  });

  it("warns and does nothing when no wallets are configured", async () => {
    delete process.env.PLATFORM_WALLET_PUBLIC_KEY;

    await startIngestionWorker();
    await flush();

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockServer.payments).not.toHaveBeenCalled();
  });

  it("does not start twice while running", async () => {
    buildPaymentsChain({ records: [] });
    await startIngestionWorker();
    await startIngestionWorker();
    await flush();

    expect(mockCursor.findOne).toHaveBeenCalledTimes(1);
  });
});

describe("trending hashtags scheduled job", () => {
  let handle;
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => clearInterval(handle));

  it("runs once immediately and returns an interval handle", async () => {
    mockRecalculate.mockResolvedValue(undefined);
    handle = startTrendingHashtagsJob();
    await flush();

    expect(handle).toBeDefined();
    expect(mockRecalculate).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith("Trending hashtag job: completed successfully");
  });

  it("swallows and logs errors from recalculation", async () => {
    mockRecalculate.mockRejectedValue(new Error("db down"));
    handle = startTrendingHashtagsJob();
    await flush();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Trending hashtag job: failed"
    );
  });
});
