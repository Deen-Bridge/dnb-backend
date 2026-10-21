import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import EducatorBalance from "../../../src/models/EducatorBalance.js";
import LedgerEntry from "../../../src/models/LedgerEntry.js";
import { EducatorBalanceRepository } from "../EducatorBalanceRepository.js";

describe("EducatorBalanceRepository", () => {
  let mongoServer;
  let repo;

  const educatorA = new mongoose.Types.ObjectId();
  const educatorB = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    repo = new EducatorBalanceRepository(EducatorBalance);
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await EducatorBalance.deleteMany({});
    await LedgerEntry.deleteMany({});
  });

  /* -------------------------------------------------------------------- */
  /* Helpers                                                              */
  /* -------------------------------------------------------------------- */

  const createBalance = (overrides = {}) =>
    EducatorBalance.create({
      educator: educatorA,
      owedStroops: "0",
      settledStroops: "0",
      ...overrides,
    });

  const createLedgerEntry = (overrides = {}) =>
    LedgerEntry.create({
      educator: educatorA,
      type: "sale",
      txRef: `tx_${new mongoose.Types.ObjectId()}`,
      amount: "10",
      amountStroops: "1000000000",
      settlement: "platform_collect",
      ...overrides,
    });

  /* -------------------------------------------------------------------- */
  /* Construction                                                         */
  /* -------------------------------------------------------------------- */

  describe("constructor", () => {
    it("creates an instance extending BaseRepository", () => {
      expect(repo).toBeInstanceOf(EducatorBalanceRepository);
      expect(repo.model).toBe(EducatorBalance);
    });

    it("accepts a custom model for testing", () => {
      const custom = new EducatorBalanceRepository(EducatorBalance);
      expect(custom.model).toBe(EducatorBalance);
    });
  });

  /* -------------------------------------------------------------------- */
  /* findByEducator                                                       */
  /* -------------------------------------------------------------------- */

  describe("findByEducator", () => {
    it("returns the balance record for an educator", async () => {
      await createBalance({ educator: educatorA, owedStroops: "500000000" });

      const result = await repo.findByEducator(educatorA);
      expect(result).toBeDefined();
      expect(result.owedStroops).toBe("500000000");
    });

    it("returns null when no balance exists", async () => {
      const result = await repo.findByEducator(new mongoose.Types.ObjectId());
      expect(result).toBeNull();
    });

    it("excludes other educators' balances", async () => {
      await createBalance({ educator: educatorA, owedStroops: "100" });
      await createBalance({ educator: educatorB, owedStroops: "200" });

      const result = await repo.findByEducator(educatorA);
      expect(result.owedStroops).toBe("100");
    });

    it("throws when educatorId is missing", async () => {
      await expect(repo.findByEducator(null)).rejects.toThrow("educatorId");
      await expect(repo.findByEducator(undefined)).rejects.toThrow("educatorId");
      await expect(repo.findByEducator("")).rejects.toThrow("educatorId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* getAvailableBalance                                                  */
  /* -------------------------------------------------------------------- */

  describe("getAvailableBalance", () => {
    it("returns the owedStroops as the available balance", async () => {
      await createBalance({ educator: educatorA, owedStroops: "1500000000" });

      const result = await repo.getAvailableBalance(educatorA);
      expect(result.stroops).toBe("1500000000");
      expect(result.amount).toBe("15");
    });

    it("returns '0' when no balance exists", async () => {
      const result = await repo.getAvailableBalance(new mongoose.Types.ObjectId());
      expect(result.stroops).toBe("0");
      expect(result.amount).toBe("0");
    });

    it("ignores settledStroops", async () => {
      await createBalance({
        educator: educatorA,
        owedStroops: "100000000",
        settledStroops: "500000000",
      });

      const result = await repo.getAvailableBalance(educatorA);
      expect(result.stroops).toBe("100000000");
      expect(result.amount).toBe("1");
    });

    it("throws when educatorId is missing", async () => {
      await expect(repo.getAvailableBalance(null)).rejects.toThrow("educatorId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* getPendingAmount                                                     */
  /* -------------------------------------------------------------------- */

  describe("getPendingAmount", () => {
    it("returns the owedStroops as the pending amount", async () => {
      await createBalance({ educator: educatorA, owedStroops: "300000000" });

      const result = await repo.getPendingAmount(educatorA);
      expect(result.stroops).toBe("300000000");
      expect(result.amount).toBe("3");
    });

    it("returns '0' when no balance exists", async () => {
      const result = await repo.getPendingAmount(new mongoose.Types.ObjectId());
      expect(result.stroops).toBe("0");
    });

    it("throws when educatorId is missing", async () => {
      await expect(repo.getPendingAmount(null)).rejects.toThrow("educatorId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* getTransactionHistory                                                */
  /* -------------------------------------------------------------------- */

  describe("getTransactionHistory", () => {
    beforeEach(async () => {
      await createLedgerEntry({
        educator: educatorA,
        type: "sale",
        amount: "10",
        amountStroops: "1000000000",
        settlement: "platform_collect",
        createdAt: new Date("2026-01-01"),
      });
      await createLedgerEntry({
        educator: educatorA,
        type: "sale",
        amount: "5",
        amountStroops: "500000000",
        settlement: "direct",
        createdAt: new Date("2026-01-02"),
      });
      await createLedgerEntry({
        educator: educatorA,
        type: "payout",
        amount: "10",
        amountStroops: "1000000000",
        txRef: "batch_001",
        createdAt: new Date("2026-01-03"),
      });
      await createLedgerEntry({
        educator: educatorB,
        type: "sale",
        amount: "50",
        amountStroops: "5000000000",
        settlement: "platform_collect",
        createdAt: new Date("2026-01-01"),
      });
    });

    it("returns ledger entries for the specified educator only", async () => {
      const result = await repo.getTransactionHistory(educatorA);
      expect(result.data).toHaveLength(3);
      for (const entry of result.data) {
        expect(entry.educator.toString()).toBe(educatorA.toString());
      }
    });

    it("excludes other educators' entries", async () => {
      const result = await repo.getTransactionHistory(educatorA);
      const hasEducatorB = result.data.some(
        (e) => e.educator.toString() === educatorB.toString()
      );
      expect(hasEducatorB).toBe(false);
    });

    it("paginates correctly", async () => {
      const page1 = await repo.getTransactionHistory(educatorA, {
        page: 1,
        limit: 2,
      });
      expect(page1.data).toHaveLength(2);
      expect(page1.total).toBe(3);
      expect(page1.totalPages).toBe(2);
      expect(page1.hasNextPage).toBe(true);
      expect(page1.hasPrevPage).toBe(false);

      const page2 = await repo.getTransactionHistory(educatorA, {
        page: 2,
        limit: 2,
      });
      expect(page2.data).toHaveLength(1);
      expect(page2.hasNextPage).toBe(false);
      expect(page2.hasPrevPage).toBe(true);
    });

    it("filters by type", async () => {
      const sales = await repo.getTransactionHistory(educatorA, {
        type: "sale",
      });
      expect(sales.data).toHaveLength(2);
      for (const entry of sales.data) {
        expect(entry.type).toBe("sale");
      }

      const payouts = await repo.getTransactionHistory(educatorA, {
        type: "payout",
      });
      expect(payouts.data).toHaveLength(1);
      expect(payouts.data[0].type).toBe("payout");
    });

    it("filters by date range", async () => {
      const result = await repo.getTransactionHistory(educatorA, {
        from: "2026-01-02",
        to: "2026-01-03",
      });
      expect(result.data).toHaveLength(2);
    });

    it("throws for invalid type", async () => {
      await expect(
        repo.getTransactionHistory(educatorA, { type: "invalid" })
      ).rejects.toThrow("type");
    });

    it("throws when educatorId is missing", async () => {
      await expect(repo.getTransactionHistory(null)).rejects.toThrow("educatorId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* reconcileBalance                                                     */
  /* -------------------------------------------------------------------- */

  describe("reconcileBalance", () => {
    it("returns isConsistent when LedgerEntry history matches stored balance", async () => {
      await createBalance({
        educator: educatorA,
        owedStroops: "500000000",
        settledStroops: "0",
      });

      await createLedgerEntry({
        educator: educatorA,
        type: "sale",
        amount: "5",
        amountStroops: "500000000",
        settlement: "platform_collect",
      });

      const result = await repo.reconcileBalance(educatorA);
      expect(result.isConsistent).toBe(true);
      expect(result.storedOwed).toBe("500000000");
      expect(result.computedOwed).toBe("500000000");
      expect(result.discrepancies).toHaveLength(0);
    });

    it("detects an induced mismatch in owedStroops", async () => {
      await createBalance({
        educator: educatorA,
        owedStroops: "99999",
        settledStroops: "0",
      });

      await createLedgerEntry({
        educator: educatorA,
        type: "sale",
        amount: "5",
        amountStroops: "500000000",
        settlement: "platform_collect",
      });

      const result = await repo.reconcileBalance(educatorA);
      expect(result.isConsistent).toBe(false);
      expect(result.storedOwed).toBe("99999");
      expect(result.computedOwed).toBe("500000000");
      expect(result.discrepancies.length).toBeGreaterThan(0);
      expect(result.discrepancies[0]).toContain("owedStroops mismatch");
    });

    it("detects an induced mismatch in settledStroops", async () => {
      await createBalance({
        educator: educatorA,
        owedStroops: "0",
        settledStroops: "11111",
      });

      await createLedgerEntry({
        educator: educatorA,
        type: "sale",
        amount: "10",
        amountStroops: "1000000000",
        settlement: "direct",
      });

      const result = await repo.reconcileBalance(educatorA);
      expect(result.isConsistent).toBe(false);
      expect(result.storedSettled).toBe("11111");
      expect(result.computedSettled).toBe("1000000000");
    });

    it("correctly reconciles mixed sale and payout entries", async () => {
      await createBalance({
        educator: educatorA,
        owedStroops: "0",
        settledStroops: "1500000000",
      });

      await createLedgerEntry({
        educator: educatorA,
        type: "sale",
        amount: "10",
        amountStroops: "1000000000",
        settlement: "platform_collect",
      });
      await createLedgerEntry({
        educator: educatorA,
        type: "sale",
        amount: "5",
        amountStroops: "500000000",
        settlement: "direct",
      });
      await createLedgerEntry({
        educator: educatorA,
        type: "payout",
        amount: "10",
        amountStroops: "1000000000",
        txRef: "batch_001",
      });

      const result = await repo.reconcileBalance(educatorA);
      expect(result.isConsistent).toBe(true);
      expect(result.computedOwed).toBe("0");
      expect(result.computedSettled).toBe("1500000000");
    });

    it("returns consistent result when no entries exist", async () => {
      await createBalance({
        educator: educatorA,
        owedStroops: "0",
        settledStroops: "0",
      });

      const result = await repo.reconcileBalance(educatorA);
      expect(result.isConsistent).toBe(true);
      expect(result.computedOwed).toBe("0");
      expect(result.computedSettled).toBe("0");
    });

    it("throws when educatorId is missing", async () => {
      await expect(repo.reconcileBalance(null)).rejects.toThrow("educatorId");
    });
  });

  /* -------------------------------------------------------------------- */
  /* deductOwedBalance — CRITICAL ATOMICITY TEST                          */
  /* -------------------------------------------------------------------- */

  describe("deductOwedBalance", () => {
    it("deducts the specified amount atomically", async () => {
      await createBalance({ educator: educatorA, owedStroops: "1000000000" });

      const result = await repo.deductOwedBalance(educatorA, "300000000");
      expect(result).toBeDefined();
      expect(result.owedStroops).toBe("700000000");
    });

    it("returns null when balance is insufficient", async () => {
      await createBalance({ educator: educatorA, owedStroops: "100000000" });

      const result = await repo.deductOwedBalance(educatorA, "200000000");
      expect(result).toBeNull();

      const balance = await EducatorBalance.findOne({ educator: educatorA });
      expect(balance.owedStroops).toBe("100000000");
    });

    it("returns null for non-existent educator", async () => {
      const result = await repo.deductOwedBalance(
        new mongoose.Types.ObjectId(),
        "100000000"
      );
      expect(result).toBeNull();
    });

    it("deducts exactly the requested amount (no rounding)", async () => {
      await createBalance({ educator: educatorA, owedStroops: "123456789" });

      const result = await repo.deductOwedBalance(educatorA, "1");
      expect(result.owedStroops).toBe("123456788");
    });

    it("allows deducting the full balance", async () => {
      await createBalance({ educator: educatorA, owedStroops: "500000000" });

      const result = await repo.deductOwedBalance(educatorA, "500000000");
      expect(result.owedStroops).toBe("0");
    });

    /**
     * CRITICAL TEST: Two concurrent withdrawal deductions against a balance
     * that can only cover ONE of them. Exactly one must succeed and the other
     * must be rejected. This proves the $expr filter prevents lost updates
     * and negative balances.
     */
    it("handles concurrent withdrawal deductions — only one succeeds", async () => {
      await createBalance({ educator: educatorA, owedStroops: "100000000" });

      const deductionA = repo.deductOwedBalance(educatorA, "80000000");
      const deductionB = repo.deductOwedBalance(educatorA, "80000000");

      const results = await Promise.all([deductionA, deductionB]);

      const successes = results.filter((r) => r !== null);
      const failures = results.filter((r) => r === null);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      const finalBalance = await EducatorBalance.findOne({ educator: educatorA });
      const finalOwed = BigInt(finalBalance.owedStroops);
      expect(finalOwed >= 0n).toBe(true);
      expect(finalOwed.toString()).toBe("20000000");
    });

    it("throws when educatorId is missing", async () => {
      await expect(repo.deductOwedBalance(null, "100")).rejects.toThrow(
        "educatorId"
      );
    });

    it("throws when amountStroops is not positive", async () => {
      await createBalance({ educator: educatorA, owedStroops: "100" });
      await expect(repo.deductOwedBalance(educatorA, "0")).rejects.toThrow(
        "positive"
      );
      await expect(repo.deductOwedBalance(educatorA, "-100")).rejects.toThrow(
        "positive"
      );
    });
  });

  /* -------------------------------------------------------------------- */
  /* creditOwedBalance                                                    */
  /* -------------------------------------------------------------------- */

  describe("creditOwedBalance", () => {
    it("credits the specified amount atomically", async () => {
      await createBalance({ educator: educatorA, owedStroops: "100000000" });

      const result = await repo.creditOwedBalance(educatorA, "500000000");
      expect(result.owedStroops).toBe("600000000");
    });

    it("creates a new balance record if none exists (upsert)", async () => {
      const result = await repo.creditOwedBalance(educatorA, "200000000");
      expect(result).toBeDefined();
      expect(result.owedStroops).toBe("200000000");
      expect(result.educator.toString()).toBe(educatorA.toString());
    });

    it("accumulates multiple credits", async () => {
      await repo.creditOwedBalance(educatorA, "100000000");
      await repo.creditOwedBalance(educatorA, "200000000");
      const result = await repo.creditOwedBalance(educatorA, "50000000");

      expect(result.owedStroops).toBe("350000000");
    });

    it("throws when educatorId is missing", async () => {
      await expect(repo.creditOwedBalance(null, "100")).rejects.toThrow(
        "educatorId"
      );
    });

    it("throws when amountStroops is not positive", async () => {
      await expect(repo.creditOwedBalance(educatorA, "0")).rejects.toThrow(
        "positive"
      );
    });
  });

  /* -------------------------------------------------------------------- */
  /* settleOwedToSettled                                                  */
  /* -------------------------------------------------------------------- */

  describe("settleOwedToSettled", () => {
    it("moves amount from owed to settled atomically", async () => {
      await createBalance({
        educator: educatorA,
        owedStroops: "500000000",
        settledStroops: "100000000",
      });

      const result = await repo.settleOwedToSettled(educatorA, "300000000");
      expect(result.owedStroops).toBe("200000000");
      expect(result.settledStroops).toBe("400000000");
    });

    it("returns null when owed balance is insufficient", async () => {
      await createBalance({
        educator: educatorA,
        owedStroops: "100000000",
        settledStroops: "0",
      });

      const result = await repo.settleOwedToSettled(educatorA, "200000000");
      expect(result).toBeNull();

      const balance = await EducatorBalance.findOne({ educator: educatorA });
      expect(balance.owedStroops).toBe("100000000");
      expect(balance.settledStroops).toBe("0");
    });

    it("handles concurrent settle operations safely", async () => {
      await createBalance({
        educator: educatorA,
        owedStroops: "100000000",
        settledStroops: "0",
      });

      const settleA = repo.settleOwedToSettled(educatorA, "80000000");
      const settleB = repo.settleOwedToSettled(educatorA, "80000000");

      const results = await Promise.all([settleA, settleB]);
      const successes = results.filter((r) => r !== null);
      const failures = results.filter((r) => r === null);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      const finalBalance = await EducatorBalance.findOne({ educator: educatorA });
      expect(BigInt(finalBalance.owedStroops) >= 0n).toBe(true);
      expect(BigInt(finalBalance.settledStroops).toString()).toBe("80000000");
    });

    it("throws when educatorId is missing", async () => {
      await expect(repo.settleOwedToSettled(null, "100")).rejects.toThrow(
        "educatorId"
      );
    });

    it("throws when amountStroops is not positive", async () => {
      await expect(repo.settleOwedToSettled(educatorA, "0")).rejects.toThrow(
        "positive"
      );
    });
  });

  /* -------------------------------------------------------------------- */
  /* _stroopsToAmount (private helper)                                    */
  /* -------------------------------------------------------------------- */

  describe("_stroopsToAmount", () => {
    it("converts stroops to USDC decimal string", () => {
      expect(repo._stroopsToAmount(0n)).toBe("0");
      expect(repo._stroopsToAmount(1n)).toBe("0.00000001");
      expect(repo._stroopsToAmount(100000000n)).toBe("1");
      expect(repo._stroopsToAmount(150000000n)).toBe("1.5");
      expect(repo._stroopsToAmount(1050000000n)).toBe("10.5");
      expect(repo._stroopsToAmount(1000000000n)).toBe("10");
    });

    it("handles large values", () => {
      expect(repo._stroopsToAmount(100000000000n)).toBe("1000");
      expect(repo._stroopsToAmount(1234567890123n)).toBe("12345.67890123");
    });

    it("trims trailing zeros in decimal part", () => {
      expect(repo._stroopsToAmount(100000010n)).toBe("1.0000001");
    });
  });
});
