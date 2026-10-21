import { jest } from "@jest/globals";
import * as StellarSdk from "@stellar/stellar-sdk";

// ---- Mocked Stellar service (no network) ----
const hasUsdcTrustline = jest.fn();
const submitTransaction = jest.fn();
const verifyPaymentOperations = jest.fn();
const loadAccount = jest.fn();
const USDC_ASSET = new StellarSdk.Asset(
  "USDC",
  StellarSdk.Keypair.random().publicKey()
);
const PLATFORM_KEY = StellarSdk.Keypair.random().publicKey();

jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  toStroops: (v) => {
    const [i, f = ""] = String(v).split(".");
    return BigInt(i) * 10000000n + BigInt((f + "0000000").slice(0, 7));
  },
  fromStroops: (s) => {
    const b = BigInt(s);
    const i = b / 10000000n;
    const f = (b % 10000000n).toString().padStart(7, "0");
    return `${i}.${f}`;
  },
  hasUsdcTrustline,
  submitTransaction,
  verifyPaymentOperations,
  getExplorerUrl: (h) => `https://explorer/tx/${h}`,
  server: { loadAccount },
  USDC: USDC_ASSET,
  networkPassphrase: "Test SDF Network ; September 2015",
  PLATFORM_WALLET_PUBLIC_KEY: PLATFORM_KEY,
}));

jest.unstable_mockModule("../src/config/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ---- Mocked models ----
const store = { balances: [], ledger: [], batches: [], users: [], txs: [] };
const thenable = (value) => ({
  session: () => Promise.resolve(value),
  sort: () => Promise.resolve(value),
  then: (res, rej) => Promise.resolve(value).then(res, rej),
});

class EducatorBalance {
  constructor(d) {
    Object.assign(this, d);
  }
  async save() {
    if (!store.balances.includes(this)) store.balances.push(this);
    return this;
  }
}
EducatorBalance.findOne = jest.fn((q) =>
  thenable(store.balances.find((b) => String(b.educator) === String(q.educator)) || null)
);
EducatorBalance.find = jest.fn(async () =>
  store.balances.filter((b) => b.owedStroops !== "0")
);

class LedgerEntry {
  constructor(d) {
    Object.assign(this, d);
  }
  async save() {
    store.ledger.push(this);
    return this;
  }
}
LedgerEntry.findOne = jest.fn((q) =>
  thenable(store.ledger.find((e) => e.txRef === q.txRef && e.type === q.type) || null)
);
LedgerEntry.find = jest.fn(() => thenable([...store.ledger]));

const batchSaveHook = { fn: null };
class PayoutBatch {
  constructor(d) {
    Object.assign(this, d);
  }
  async save() {
    if (batchSaveHook.fn) await batchSaveHook.fn(this);
    this.history = this.history || [];
    this.history.push(this.status);
    if (!store.batches.includes(this)) store.batches.push(this);
    return this;
  }
}
PayoutBatch.findOne = jest.fn(async (q) =>
  store.batches.find((b) => b.batchId === q.batchId) || null
);
PayoutBatch.find = jest.fn(() => thenable(store.batches.filter((b) => b.status === "confirmed")));

const User = { find: jest.fn(async (q) => store.users.filter((u) => q._id.$in.map(String).includes(String(u._id)))) };
const Transaction = { find: jest.fn() };

jest.unstable_mockModule("../src/models/EducatorBalance.js", () => ({ default: EducatorBalance }));
jest.unstable_mockModule("../src/models/LedgerEntry.js", () => ({ default: LedgerEntry }));
jest.unstable_mockModule("../src/models/PayoutBatch.js", () => ({ default: PayoutBatch }));
jest.unstable_mockModule("../src/models/User.js", () => ({ default: User }));
jest.unstable_mockModule("../src/models/Transaction.js", () => ({ default: Transaction }));

const mongoose = (await import("mongoose")).default;
const svc = await import("../src/services/payoutService.js");
const { isPayoutAdmin, buildBatch, submitBatch } = await import("../src/controllers/payoutController.js");

const session = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  abortTransaction: jest.fn(),
  endSession: jest.fn(),
};

const oid = () => new mongoose.Types.ObjectId();
const wallet = () => StellarSdk.Keypair.random().publicKey();

const addEducator = ({ owed = "50000000", withWallet = true, name = "Edu" } = {}) => {
  const u = {
    _id: oid(),
    name,
    stellarWallet: withWallet ? { publicKey: wallet() } : undefined,
  };
  store.users.push(u);
  const b = new EducatorBalance({ educator: u._id, owedStroops: owed, settledStroops: "0" });
  store.balances.push(b);
  return { u, b };
};

beforeEach(() => {
  store.balances = [];
  store.ledger = [];
  store.batches = [];
  store.users = [];
  jest.clearAllMocks();
  batchSaveHook.fn = null;
  hasUsdcTrustline.mockResolvedValue(true);
  loadAccount.mockRejectedValue(new Error("offline"));
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
});

afterEach(() => jest.restoreAllMocks());

describe("recordSaleEarnings", () => {
  const confirmedTx = (over = {}) => ({
    _id: oid(),
    status: "confirmed",
    creator: oid(),
    amount: "10.0000000",
    stellarTxHash: "hash-1",
    settlement: "platform_collect",
    platformFee: { creatorAmount: "9.0000000" },
    ...over,
  });

  it("rejects unconfirmed transactions", async () => {
    const r = await svc.recordSaleEarnings(confirmedTx({ status: "pending" }));
    expect(r).toEqual({ success: false, reason: "Transaction not confirmed" });
    expect(store.ledger).toHaveLength(0);
  });

  it("rejects transactions without a creator", async () => {
    const r = await svc.recordSaleEarnings(confirmedTx({ creator: null }));
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/no creator/);
  });

  it("credits owed for platform_collect using the creator net amount", async () => {
    const tx = confirmedTx();
    const r = await svc.recordSaleEarnings(tx);
    expect(r.success).toBe(true);
    expect(store.balances[0].owedStroops).toBe("90000000");
    expect(store.balances[0].settledStroops).toBe("0");
    expect(store.ledger[0]).toMatchObject({ type: "sale", txRef: "hash-1", amountStroops: "90000000" });
  });

  it("credits settled for direct sales and falls back to gross amount", async () => {
    await svc.recordSaleEarnings(confirmedTx({ settlement: undefined, platformFee: undefined }));
    expect(store.balances[0].settledStroops).toBe("100000000");
    expect(store.balances[0].owedStroops).toBe("0");
  });

  it("is idempotent per txRef and falls back to _id when no hash", async () => {
    const tx = confirmedTx({ stellarTxHash: undefined });
    await svc.recordSaleEarnings(tx);
    const again = await svc.recordSaleEarnings(tx);
    expect(again.idempotentSkipped).toBe(true);
    expect(store.ledger).toHaveLength(1);
    expect(store.ledger[0].txRef).toBe(tx._id.toString());
  });

  it("passes the session through to queries and saves", async () => {
    const saveSpy = jest.spyOn(EducatorBalance.prototype, "save");
    await svc.recordSaleEarnings(confirmedTx(), { session });
    expect(saveSpy).toHaveBeenCalledWith({ session });
  });
});

describe("buildPayoutBatch", () => {
  it("skips educators below minimum, without wallet, or without trustline", async () => {
    addEducator({ owed: "0", name: "zero" });
    addEducator({ owed: "10000000", name: "small" });
    addEducator({ owed: "50000000", withWallet: false, name: "nowallet" });
    const noTrust = addEducator({ owed: "50000000", name: "notrust" });
    hasUsdcTrustline.mockImplementation(async (k) => k !== noTrust.u.stellarWallet.publicKey);
    const ok = addEducator({ owed: "50000000", name: "ok" });

    const r = await svc.buildPayoutBatch({
      educatorIds: store.users.map((u) => u._id),
      minAmount: "2",
      dryRun: true,
    });
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.name, s.reason]));
    expect(reasons).toEqual({
      zero: "below minimum",
      small: "below minimum",
      nowallet: "no wallet",
      notrust: "no USDC trustline",
    });
    expect(r.recipients.map((x) => x.name)).toEqual(["ok"]);
    expect(r.totalStroops).toBe("50000000");
    expect(r.totalAmount).toBe("5.0000000");
    expect(ok.u).toBeDefined();
  });

  it("dry run persists nothing", async () => {
    addEducator();
    const r = await svc.buildPayoutBatch({ dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(store.batches).toHaveLength(0);
  });

  it("returns failure when no eligible educators", async () => {
    addEducator({ owed: "0" });
    const r = await svc.buildPayoutBatch({ educatorIds: store.users.map((u) => u._id) });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/No eligible/);
    expect(store.batches).toHaveLength(0);
  });

  it("creates a 'built' batch with createdBy, memo and one XDR per chunk", async () => {
    const a = addEducator();
    const adminId = oid();
    const r = await svc.buildPayoutBatch({ adminId });
    expect(r.success).toBe(true);
    expect(r.status).toBe("built");
    expect(r.chunks).toHaveLength(1);
    expect(store.batches).toHaveLength(1);
    expect(store.batches[0]).toMatchObject({ status: "built", createdBy: adminId, totalStroops: "50000000" });
    const tx = new StellarSdk.Transaction(r.chunks[0].xdr, "Test SDF Network ; September 2015");
    expect(tx.memo.value.toString()).toBe(`DNB-PAYOUT-${r.batchId.slice(-16)}`);
    expect(tx.operations[0].destination).toBe(a.u.stellarWallet.publicKey);
    expect(tx.operations[0].amount).toBe("5.0000000");
    // build does not touch balances or ledger
    expect(a.b.owedStroops).toBe("50000000");
    expect(store.ledger).toHaveLength(0);
  });

  it("uses the loaded account when Horizon is reachable", async () => {
    addEducator();
    loadAccount.mockResolvedValue(new StellarSdk.Account(PLATFORM_KEY, "42"));
    const r = await svc.buildPayoutBatch({});
    expect(loadAccount).toHaveBeenCalledWith(PLATFORM_KEY);
    expect(r.success).toBe(true);
  });

  it("splits more than 100 recipients into multiple chunks", async () => {
    for (let i = 0; i < 101; i++) addEducator({ name: `e${i}` });
    const r = await svc.buildPayoutBatch({});
    expect(r.chunks).toHaveLength(2);
    const t0 = new StellarSdk.Transaction(r.chunks[0].xdr, "Test SDF Network ; September 2015");
    const t1 = new StellarSdk.Transaction(r.chunks[1].xdr, "Test SDF Network ; September 2015");
    expect(t0.operations).toHaveLength(100);
    expect(t1.operations).toHaveLength(1);
  });

  it("falls back to the module platform key when the env var is empty", async () => {
    // fall back chain: env var, then module constant; clear env and rely on module constant being set
    const prev = process.env.PLATFORM_WALLET_PUBLIC_KEY;
    process.env.PLATFORM_WALLET_PUBLIC_KEY = "";
    addEducator();
    const r = await svc.buildPayoutBatch({});
    expect(r.success).toBe(true); // module constant fallback used
    if (prev !== undefined) process.env.PLATFORM_WALLET_PUBLIC_KEY = prev;
    else delete process.env.PLATFORM_WALLET_PUBLIC_KEY;
  });
});

describe("submitPayoutBatch status transitions and failure paths", () => {
  const makeBatch = async (n = 1) => {
    const eds = Array.from({ length: n }, () => addEducator());
    const r = await svc.buildPayoutBatch({});
    return { eds, batch: store.batches[0], r };
  };

  it("throws for unknown or already confirmed batches", async () => {
    await expect(svc.submitPayoutBatch({ batchId: "nope", signedXdrs: ["x"] })).rejects.toThrow(
      /not found or already processed/
    );
    const { batch } = await makeBatch();
    batch.status = "confirmed";
    await expect(svc.submitPayoutBatch({ batchId: batch.batchId, signedXdrs: ["x"] })).rejects.toThrow(
      /already processed/
    );
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the XDR count does not match chunk count", async () => {
    const { batch } = await makeBatch();
    await expect(
      svc.submitPayoutBatch({ batchId: batch.batchId, signedXdrs: ["a", "b"] })
    ).rejects.toThrow(/Expected 1 signed XDR\(s\), but received 2/);
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("accepts a single XDR string and settles built -> confirmed", async () => {
    const { eds, batch } = await makeBatch();
    submitTransaction.mockResolvedValue({ hash: "H1" });
    verifyPaymentOperations.mockResolvedValue({ verified: true });

    const r = await svc.submitPayoutBatch({ batchId: batch.batchId, signedXdrs: "signed" });

    expect(r).toMatchObject({ success: true, status: "confirmed", totalRecipients: 1 });
    expect(batch.status).toBe("confirmed");
    expect(batch.chunks[0].hash).toBe("H1");
    expect(eds[0].b.owedStroops).toBe("0");
    expect(eds[0].b.settledStroops).toBe("50000000");
    expect(eds[0].b.lastPayoutAt).toBeInstanceOf(Date);
    expect(store.ledger).toHaveLength(1);
    expect(store.ledger[0]).toMatchObject({ type: "payout", txRef: batch.batchId, amountStroops: "50000000" });
    expect(session.commitTransaction).toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
    expect(verifyPaymentOperations).toHaveBeenCalledWith("H1", [
      { destination: eds[0].u.stellarWallet.publicKey, amount: "5.0000000" },
    ]);
  });

  it("records failed then reverts to built when Stellar submission throws", async () => {
    const { eds, batch } = await makeBatch();
    submitTransaction.mockRejectedValue(new Error("tx_bad_seq"));
    await expect(svc.submitPayoutBatch({ batchId: batch.batchId, signedXdrs: ["x"] })).rejects.toThrow(
      "Stellar submission failed: tx_bad_seq"
    );
    expect(batch.history.slice(-2)).toEqual(["failed", "built"]);
    expect(batch.status).toBe("built");
    expect(batch.failureReason).toMatch(/chunk 0: tx_bad_seq/);
    expect(eds[0].b.owedStroops).toBe("50000000");
    expect(store.ledger).toHaveLength(0);
    expect(verifyPaymentOperations).not.toHaveBeenCalled();
  });

  it("records failed then reverts to built when on-chain verification fails", async () => {
    const { eds, batch } = await makeBatch();
    submitTransaction.mockResolvedValue({ hash: "H" });
    verifyPaymentOperations.mockResolvedValue({ verified: false, reason: "amount mismatch" });
    await expect(svc.submitPayoutBatch({ batchId: batch.batchId, signedXdrs: ["x"] })).rejects.toThrow(
      "Verification failed for chunk 0: amount mismatch"
    );
    expect(batch.history.slice(-2)).toEqual(["failed", "built"]);
    expect(batch.failureReason).toBe("Verification failed for chunk 0: amount mismatch");
    expect(eds[0].b.owedStroops).toBe("50000000");
    expect(eds[0].b.settledStroops).toBe("0");
    expect(store.ledger).toHaveLength(0);
  });

  it("allows resubmission of a batch in 'failed' status", async () => {
    const { batch } = await makeBatch();
    batch.status = "failed";
    submitTransaction.mockResolvedValue({ hash: "H" });
    verifyPaymentOperations.mockResolvedValue({ verified: true });
    const r = await svc.submitPayoutBatch({ batchId: batch.batchId, signedXdrs: ["x"] });
    expect(r.status).toBe("confirmed");
  });

  it("aborts the DB transaction and reverts to built when settlement fails", async () => {
    const { batch } = await makeBatch();
    submitTransaction.mockResolvedValue({ hash: "H" });
    verifyPaymentOperations.mockResolvedValue({ verified: true });
    jest.spyOn(LedgerEntry.prototype, "save").mockRejectedValue(new Error("db down"));

    await expect(svc.submitPayoutBatch({ batchId: batch.batchId, signedXdrs: ["x"] })).rejects.toThrow("db down");

    expect(session.abortTransaction).toHaveBeenCalled();
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
    expect(batch.status).toBe("built");
    expect(batch.failureReason).toBe("db down");
  });

  it("clamps owed at zero if balance is lower than the payout", async () => {
    const { eds, batch } = await makeBatch();
    eds[0].b.owedStroops = "10";
    submitTransaction.mockResolvedValue({ hash: "H" });
    verifyPaymentOperations.mockResolvedValue({ verified: true });
    await svc.submitPayoutBatch({ batchId: batch.batchId, signedXdrs: ["x"] });
    expect(eds[0].b.owedStroops).toBe("0");
    expect(eds[0].b.settledStroops).toBe("50000000");
  });

  it("verifies each chunk of a multi-chunk batch and stops at the first failing chunk", async () => {
    for (let i = 0; i < 101; i++) addEducator();
    await svc.buildPayoutBatch({});
    const batch = store.batches[0];
    submitTransaction.mockResolvedValueOnce({ hash: "A" }).mockResolvedValueOnce({ hash: "B" });
    verifyPaymentOperations
      .mockResolvedValueOnce({ verified: true })
      .mockResolvedValueOnce({ verified: false, reason: "missing op" });

    await expect(
      svc.submitPayoutBatch({ batchId: batch.batchId, signedXdrs: ["x1", "x2"] })
    ).rejects.toThrow(/chunk 1: missing op/);
    expect(verifyPaymentOperations.mock.calls[0][1]).toHaveLength(100);
    expect(verifyPaymentOperations.mock.calls[1][1]).toHaveLength(1);
    expect(store.ledger).toHaveLength(0);
    expect(batch.status).toBe("built");
  });
});

describe("read helpers", () => {
  it("getEducatorBalance defaults to zeros with no record", async () => {
    const r = await svc.getEducatorBalance(oid());
    expect(r).toMatchObject({ owedStroops: "0", settledStroops: "0", lastPayoutAt: null });
  });

  it("getEducatorBalance sums owed and settled", async () => {
    const { u } = addEducator({ owed: "30000000" });
    store.balances[0].settledStroops = "20000000";
    const r = await svc.getEducatorBalance(u._id);
    expect(r.lifetime).toBe("5.0000000");
  });

  it("getEducatorStatement builds date filters and maps fees", async () => {
    Transaction.find.mockReturnValue({
      sort: async () => [
        { _id: "t1", amount: "10", platformFee: { platformAmount: "1", creatorAmount: "9" }, createdAt: "c", stellarTxHash: "h" },
        { _id: "t2", amount: "5", createdAt: "c2" },
      ],
    });
    const r = await svc.getEducatorStatement("e1", { from: "2024-01-01", to: "2024-02-01" });
    const q = Transaction.find.mock.calls[0][0];
    expect(q).toMatchObject({ creator: "e1", status: "confirmed" });
    expect(q.createdAt.$gte).toBeInstanceOf(Date);
    expect(q.createdAt.$lte).toBeInstanceOf(Date);
    expect(r[0]).toMatchObject({ gross: "10", fee: "1", net: "9", settlement: "direct" });
    expect(r[1]).toMatchObject({ fee: "0", net: "5" });
  });

  it("getEducatorHistory returns hashes and explorer URLs for the educator only", async () => {
    const e1 = oid();
    store.batches.push({
      batchId: "b1",
      status: "confirmed",
      updatedAt: "d",
      recipients: [{ educator: oid(), amount: "1" }, { educator: e1, amount: "2.0000000" }],
      chunks: [{ hash: "H1" }, {}],
    });
    const r = await svc.getEducatorHistory(e1);
    expect(r[0]).toMatchObject({ batchId: "b1", amount: "2.0000000", hashes: ["H1"], explorerUrls: ["https://explorer/tx/H1"] });
  });
});

describe("recalculateBalancesFromLedger (reconciliation)", () => {
  it("reports exact match after sale + payout", async () => {
    const ed = oid();
    store.ledger.push(
      { educator: ed, type: "sale", settlement: "platform_collect", amountStroops: "100" },
      { educator: ed, type: "payout", amountStroops: "40" }
    );
    store.balances.push({ educator: ed, owedStroops: "60", settledStroops: "40" });
    const r = await svc.recalculateBalancesFromLedger();
    expect(r.isExact).toBe(true);
    expect(r.auditReport[0].match).toBe(true);
  });

  it("flags drift between stored and ledger-derived balances", async () => {
    const ed = oid();
    store.ledger.push({ educator: ed, type: "sale", settlement: "direct", amountStroops: "100" });
    store.balances.push({ educator: ed, owedStroops: "5", settledStroops: "100" });
    const r = await svc.recalculateBalancesFromLedger();
    expect(r.isExact).toBe(false);
    expect(r.auditReport[0]).toMatchObject({ storedOwed: "5", computedOwed: "0", match: false });
  });
});

describe("isPayoutAdmin", () => {
  const prev = process.env.PAYOUT_ADMIN_USER_IDS;
  afterAll(() => {
    if (prev === undefined) delete process.env.PAYOUT_ADMIN_USER_IDS;
    else process.env.PAYOUT_ADMIN_USER_IDS = prev;
  });

  it("denies when allowlist is empty or user missing", () => {
    process.env.PAYOUT_ADMIN_USER_IDS = "";
    expect(isPayoutAdmin({ _id: "a" })).toBe(false);
    expect(isPayoutAdmin(null)).toBe(false);
    expect(isPayoutAdmin({})).toBe(false);
  });

  it("matches trimmed ids, including ObjectIds", () => {
    const id = oid();
    process.env.PAYOUT_ADMIN_USER_IDS = ` x , ${id.toString()} ,`;
    expect(isPayoutAdmin({ _id: id })).toBe(true);
    expect(isPayoutAdmin({ _id: "y" })).toBe(false);
  });
});

describe("payout controller handlers", () => {
  const mkRes = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };
  const admin = { _id: oid() };
  beforeEach(() => {
    process.env.PAYOUT_ADMIN_USER_IDS = admin._id.toString();
  });

  it("buildBatch returns 403 for non-operators and builds nothing", async () => {
    const res = mkRes();
    await buildBatch({ user: { _id: oid() }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(store.batches).toHaveLength(0);
  });

  it("buildBatch dry run returns 200 plan", async () => {
    addEducator();
    const res = mkRes();
    await buildBatch({ user: admin, body: { dryRun: true } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, dryRun: true, totalRecipients: 1 });
  });

  it("buildBatch returns 400 when nobody is eligible", async () => {
    const res = mkRes();
    await buildBatch({ user: admin, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("buildBatch real run returns 200 with batchId", async () => {
    addEducator();
    const res = mkRes();
    await buildBatch({ user: admin, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, status: "built" });
  });

  it("submitBatch returns 403 for non-operators", async () => {
    const res = mkRes();
    await submitBatch({ user: { _id: oid() }, params: { batchId: "b" }, body: { signedXdrs: ["x"] } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("submitBatch returns 400 when XDRs are missing", async () => {
    const res = mkRes();
    await submitBatch({ user: admin, params: { batchId: "b" }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/required/);
  });

  it("submitBatch maps service errors to 400 and accepts legacy signedXdr", async () => {
    const res = mkRes();
    await submitBatch({ user: admin, params: { batchId: "missing" }, body: { signedXdr: "x" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/not found or already processed/);
  });

  it("submitBatch settles a built batch end to end", async () => {
    addEducator();
    const built = await svc.buildPayoutBatch({});
    submitTransaction.mockResolvedValue({ hash: "H" });
    verifyPaymentOperations.mockResolvedValue({ verified: true });
    const res = mkRes();
    await submitBatch({ user: admin, params: { batchId: built.batchId }, body: { signedXdrs: ["x"] } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, status: "confirmed" });
  });
});
