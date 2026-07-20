// test/payout.test.js
import { jest } from "@jest/globals";
import mongoose from "mongoose";
import * as StellarSdk from "@stellar/stellar-sdk";
import User from "../src/models/User.js";
import Transaction from "../src/models/Transaction.js";
import EducatorBalance from "../src/models/EducatorBalance.js";
import LedgerEntry from "../src/models/LedgerEntry.js";
import PayoutBatch from "../src/models/PayoutBatch.js";
import {
  toStroops,
  fromStroops,
  networkPassphrase,
  USDC_ISSUER,
  server,
} from "../src/services/stellar/stellarService.js";
import {
  recordSaleEarnings,
  buildPayoutBatch,
  submitPayoutBatch,
  recalculateBalancesFromLedger,
} from "../src/services/payoutService.js";
import { isPayoutAdmin } from "../src/controllers/payoutController.js";

const PLATFORM_WALLET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const createMockQuery = (result) => {
  const query = {
    session: () => query,
    sort: () => query,
    select: () => query,
    then: (onRes, onRej) => Promise.resolve(result).then(onRes, onRej),
  };
  return query;
};

describe("Payout Service & Earnings Ledger", () => {
  let usersStore = [];
  let balancesStore = [];
  let ledgerStore = [];
  let batchesStore = [];

  beforeAll(() => {
    process.env.PLATFORM_WALLET_PUBLIC_KEY = PLATFORM_WALLET;

    // Mock mongoose startSession
    jest.spyOn(mongoose, "startSession").mockResolvedValue({
      startTransaction: () => {},
      commitTransaction: async () => {},
      abortTransaction: async () => {},
      endSession: () => {},
    });

    // Mock EducatorBalance
    jest.spyOn(EducatorBalance, "findOne").mockImplementation((query) => {
      const educatorId = query?.educator?.toString();
      const found = balancesStore.find((b) => b.educator.toString() === educatorId);
      return createMockQuery(found || null);
    });

    jest.spyOn(EducatorBalance, "find").mockImplementation((query) => {
      let list = [...balancesStore];
      if (query?.owedStroops?.$ne === "0") {
        list = list.filter((b) => b.owedStroops !== "0");
      }
      return createMockQuery(list);
    });

    // Mock LedgerEntry
    jest.spyOn(LedgerEntry, "findOne").mockImplementation((query) => {
      let found;
      if (query?.txRef && query?.type) {
        found = ledgerStore.find(
          (l) => l.txRef === query.txRef && l.type === query.type
        );
      } else if (query?.educator && query?.type) {
        found = ledgerStore.find(
          (l) =>
            l.educator.toString() === query.educator.toString() &&
            l.type === query.type
        );
      }
      return createMockQuery(found || null);
    });

    jest.spyOn(LedgerEntry, "find").mockImplementation(() => {
      const sorted = [...ledgerStore];
      return createMockQuery(sorted);
    });

    // Mock User
    jest.spyOn(User, "find").mockImplementation((query) => {
      let list = [...usersStore];
      if (query?._id?.$in) {
        const ids = query._id.$in.map((id) => id.toString());
        list = list.filter((u) => ids.includes(u._id.toString()));
      }
      return createMockQuery(list);
    });

    // Mock PayoutBatch
    jest.spyOn(PayoutBatch, "findOne").mockImplementation((query) => {
      const found = batchesStore.find((b) => b.batchId === query.batchId);
      return createMockQuery(found || null);
    });

    jest.spyOn(PayoutBatch, "countDocuments").mockImplementation(async () => {
      return batchesStore.length;
    });
  });

  beforeEach(() => {
    usersStore = [];
    balancesStore = [];
    ledgerStore = [];
    batchesStore = [];

    // Fast mock for Horizon server account load
    jest.spyOn(server, "loadAccount").mockImplementation(async (key) => {
      const acc = new StellarSdk.Account(key || PLATFORM_WALLET, "1000");
      acc.balances = [
        { asset_type: "native", balance: "10" },
        { asset_code: "USDC", asset_issuer: USDC_ISSUER, balance: "100" },
      ];
      return acc;
    });
  });

  describe("Stroop Math & Precision", () => {
    it("converts decimal amounts to stroops and back precisely", () => {
      expect(toStroops("100")).toBe(1000000000n);
      expect(toStroops("10.5")).toBe(105000000n);
      expect(toStroops("0.0000001")).toBe(1n);

      expect(fromStroops(1000000000n)).toBe("100");
      expect(fromStroops(10500000n)).toBe("1.05");
      expect(fromStroops(1n)).toBe("0.0000001");
    });
  });

  describe("Record Sale Earnings & Idempotency", () => {
    it("credits earnings on transaction confirmation and is idempotent", async () => {
      const educatorId = new mongoose.Types.ObjectId();
      const mockTx = {
        _id: new mongoose.Types.ObjectId(),
        stellarTxHash: "hash_sale_100",
        creator: educatorId,
        amount: "50",
        settlement: "platform_collect",
        status: "confirmed",
        platformFee: {
          feePercent: 10,
          platformWallet: PLATFORM_WALLET,
          platformAmount: "5",
          creatorAmount: "45",
        },
      };

      jest.spyOn(EducatorBalance.prototype, "save").mockImplementation(function () {
        const existingIdx = balancesStore.findIndex(
          (b) => b.educator.toString() === this.educator.toString()
        );
        if (existingIdx >= 0) balancesStore[existingIdx] = this;
        else balancesStore.push(this);
        return Promise.resolve(this);
      });

      jest.spyOn(LedgerEntry.prototype, "save").mockImplementation(function () {
        ledgerStore.push(this);
        return Promise.resolve(this);
      });

      // 1. Record earnings first time
      const res1 = await recordSaleEarnings(mockTx);
      expect(res1.success).toBe(true);
      expect(res1.idempotentSkipped).toBeUndefined();

      expect(balancesStore.length).toBe(1);
      expect(balancesStore[0].owedStroops).toBe("450000000"); // 45 USDC net
      expect(ledgerStore.length).toBe(1);
      expect(ledgerStore[0].type).toBe("sale");
      expect(ledgerStore[0].amount).toBe("45");
      expect(ledgerStore[0].settlement).toBe("platform_collect");

      // 2. Second call with same transaction -> Idempotent skip
      const res2 = await recordSaleEarnings(mockTx);
      expect(res2.success).toBe(true);
      expect(res2.idempotentSkipped).toBe(true);
      expect(balancesStore[0].owedStroops).toBe("450000000");
      expect(ledgerStore.length).toBe(1);

      // Audit check
      const audit = await recalculateBalancesFromLedger();
      expect(audit.isExact).toBe(true);
    });

    it("credits direct-paid sales to settledStroops immediately", async () => {
      const educatorId = new mongoose.Types.ObjectId();
      const mockTx = {
        _id: new mongoose.Types.ObjectId(),
        stellarTxHash: "hash_direct_200",
        creator: educatorId,
        amount: "20",
        settlement: "direct",
        status: "confirmed",
      };

      jest.spyOn(EducatorBalance.prototype, "save").mockImplementation(function () {
        const existingIdx = balancesStore.findIndex(
          (b) => b.educator.toString() === this.educator.toString()
        );
        if (existingIdx >= 0) balancesStore[existingIdx] = this;
        else balancesStore.push(this);
        return Promise.resolve(this);
      });

      jest.spyOn(LedgerEntry.prototype, "save").mockImplementation(function () {
        ledgerStore.push(this);
        return Promise.resolve(this);
      });

      await recordSaleEarnings(mockTx);
      expect(balancesStore[0].owedStroops).toBe("0");
      expect(balancesStore[0].settledStroops).toBe("200000000"); // 20 USDC
    });
  });

  describe("Dry-Run Purity & Filtering", () => {
    it("returns payout plan with skipped educators and creates zero DB records", async () => {
      const ed1 = {
        _id: new mongoose.Types.ObjectId(),
        name: "Ed Eligible",
        stellarWallet: { publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
      };
      const ed2 = {
        _id: new mongoose.Types.ObjectId(),
        name: "Ed No Wallet",
      };
      const ed3 = {
        _id: new mongoose.Types.ObjectId(),
        name: "Ed Low",
        stellarWallet: { publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
      };

      usersStore.push(ed1, ed2, ed3);
      balancesStore.push(
        { educator: ed1._id, owedStroops: "500000000" }, // 50 USDC
        { educator: ed2._id, owedStroops: "300000000" }, // 30 USDC
        { educator: ed3._id, owedStroops: "10000000" }   // 1 USDC
      );

      jest.spyOn(server, "loadAccount").mockImplementation(async (key) => {
        if (key === ed1.stellarWallet.publicKey) {
          return {
            balances: [
              { asset_type: "native", balance: "10" },
              { asset_code: "USDC", asset_issuer: USDC_ISSUER, balance: "50" },
            ],
          };
        }
        const error = new Error("Not Found");
        error.response = { status: 404 };
        throw error;
      });

      const plan = await buildPayoutBatch({
        minAmount: "10",
        dryRun: true,
      });

      expect(plan.dryRun).toBe(true);
      expect(plan.totalRecipients).toBe(1);
      expect(plan.totalAmount).toBe("50");
      expect(plan.recipients[0].name).toBe("Ed Eligible");

      const skippedReasons = plan.skipped.map((s) => ({
        name: s.name,
        reason: s.reason,
      }));
      expect(skippedReasons).toContainEqual({
        name: "Ed No Wallet",
        reason: "no wallet",
      });
      expect(skippedReasons).toContainEqual({
        name: "Ed Low",
        reason: "below minimum",
      });

      expect(batchesStore.length).toBe(0);
    });
  });

  describe("Batch Chunking & XDR Op-shape Assertions", () => {
    it("chunks >100 recipients into <=100-op XDRs with correct payment operation shape", async () => {
      jest.spyOn(PayoutBatch.prototype, "save").mockImplementation(function () {
        batchesStore.push(this);
        return Promise.resolve(this);
      });

      const edCount = 105;
      const educatorIds = [];

      for (let i = 0; i < edCount; i++) {
        const keypair = StellarSdk.Keypair.random();
        const id = new mongoose.Types.ObjectId();
        usersStore.push({
          _id: id,
          name: `Educator ${i}`,
          stellarWallet: { publicKey: keypair.publicKey() },
        });
        balancesStore.push({
          educator: id,
          owedStroops: "100000000", // 10 USDC
        });
        educatorIds.push(id);
      }

      const result = await buildPayoutBatch({
        educatorIds,
        minAmount: "1",
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(result.totalRecipients).toBe(105);
      expect(result.chunks.length).toBe(2);

      // Decode Chunk 0 XDR
      const txChunk0 = StellarSdk.TransactionBuilder.fromXDR(
        result.chunks[0].xdr,
        networkPassphrase
      );
      expect(txChunk0.operations.length).toBe(100);
      expect(txChunk0.operations[0].type).toBe("payment");
      expect(toStroops(txChunk0.operations[0].amount)).toBe(toStroops("10"));
      expect(txChunk0.operations[0].asset.code).toBe("USDC");
      expect(txChunk0.operations[0].asset.issuer).toBe(USDC_ISSUER);

      // Decode Chunk 1 XDR
      const txChunk1 = StellarSdk.TransactionBuilder.fromXDR(
        result.chunks[1].xdr,
        networkPassphrase
      );
      expect(txChunk1.operations.length).toBe(5);
    });
  });

  describe("Settle-on-Verify Flow & Tamper Resistance", () => {
    it("reverts batch to built status and leaves balances untouched when verification fails", async () => {
      const edId = new mongoose.Types.ObjectId();
      const ed = {
        _id: edId,
        name: "Ed Fail",
        stellarWallet: { publicKey: PLATFORM_WALLET },
      };
      usersStore.push(ed);
      balancesStore.push({ educator: edId, owedStroops: "50000000" });

      jest.spyOn(server, "submitTransaction").mockResolvedValue({
        hash: "dummy_tx_hash",
        ledger: 12345,
        successful: true,
      });

      jest.spyOn(server, "transactions").mockReturnValue({
        transaction: () => ({
          call: async () => ({ successful: true, ledger: 12345, created_at: new Date().toISOString() }),
        }),
      });

      // Verification fails due to missing payment operations
      jest.spyOn(server, "operations").mockReturnValue({
        forTransaction: () => ({
          call: async () => ({ records: [] }),
        }),
      });

      jest.spyOn(PayoutBatch.prototype, "save").mockImplementation(function () {
        const existingIdx = batchesStore.findIndex((b) => b.batchId === this.batchId);
        if (existingIdx >= 0) batchesStore[existingIdx] = this;
        else batchesStore.push(this);
        return Promise.resolve(this);
      });

      const buildRes = await buildPayoutBatch({
        educatorIds: [edId],
        minAmount: "1",
        dryRun: false,
      });

      await expect(
        submitPayoutBatch({
          batchId: buildRes.batchId,
          signedXdrs: [buildRes.chunks[0].xdr],
        })
      ).rejects.toThrow("Verification failed for chunk 0");

      const balance = balancesStore.find((b) => b.educator.toString() === edId.toString());
      expect(balance.owedStroops).toBe("50000000"); // 5 USDC untouched

      const batch = batchesStore.find((b) => b.batchId === buildRes.batchId);
      expect(batch.status).toBe("built");
      expect(batch.failureReason).toContain("Verification failed");
    });

    it("settles owed to settled and appends payout ledger entries when verification passes", async () => {
      const edId = new mongoose.Types.ObjectId();
      const ed = {
        _id: edId,
        name: "Ed Pass",
        stellarWallet: { publicKey: PLATFORM_WALLET },
      };
      usersStore.push(ed);

      const mockBalance = {
        educator: edId,
        owedStroops: "50000000",
        settledStroops: "0",
        save: function () { return Promise.resolve(this); },
      };
      balancesStore.push(mockBalance);

      jest.spyOn(server, "submitTransaction").mockResolvedValue({
        hash: "hash_confirmed_payout",
        ledger: 999,
        successful: true,
      });

      jest.spyOn(server, "transactions").mockReturnValue({
        transaction: () => ({
          call: async () => ({ successful: true, ledger: 999, created_at: new Date().toISOString() }),
        }),
      });

      jest.spyOn(server, "operations").mockReturnValue({
        forTransaction: () => ({
          call: async () => ({
            records: [
              {
                type: "payment",
                asset_code: "USDC",
                asset_issuer: USDC_ISSUER,
                to: PLATFORM_WALLET,
                amount: "5.0000000",
              },
            ],
          }),
        }),
      });

      jest.spyOn(PayoutBatch.prototype, "save").mockImplementation(function () {
        const existingIdx = batchesStore.findIndex((b) => b.batchId === this.batchId);
        if (existingIdx >= 0) batchesStore[existingIdx] = this;
        else batchesStore.push(this);
        return Promise.resolve(this);
      });

      jest.spyOn(LedgerEntry.prototype, "save").mockImplementation(function () {
        ledgerStore.push(this);
        return Promise.resolve(this);
      });

      const buildRes = await buildPayoutBatch({
        educatorIds: [edId],
        minAmount: "1",
        dryRun: false,
      });

      const submitRes = await submitPayoutBatch({
        batchId: buildRes.batchId,
        signedXdrs: [buildRes.chunks[0].xdr],
      });

      expect(submitRes.success).toBe(true);
      expect(submitRes.status).toBe("confirmed");

      expect(mockBalance.owedStroops).toBe("0");
      expect(mockBalance.settledStroops).toBe("50000000");

      const payoutLedger = ledgerStore.find((l) => l.type === "payout");
      expect(payoutLedger).toBeDefined();
      expect(payoutLedger.amount).toBe("5");
      expect(payoutLedger.txRef).toBe(buildRes.batchId);
    });
  });

  describe("Operator Allowlist & RBAC Gating", () => {
    it("checks isPayoutAdmin against PAYOUT_ADMIN_USER_IDS allowlist", () => {
      process.env.PAYOUT_ADMIN_USER_IDS = "admin_user_1, admin_user_2";

      expect(isPayoutAdmin({ _id: "admin_user_1" })).toBe(true);
      expect(isPayoutAdmin({ _id: "admin_user_2" })).toBe(true);
      expect(isPayoutAdmin({ _id: "student_user_99" })).toBe(false);

      process.env.PAYOUT_ADMIN_USER_IDS = "";
      expect(isPayoutAdmin({ _id: "admin_user_1" })).toBe(false);
    });
  });
});
