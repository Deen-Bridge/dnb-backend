/**
 * @module mongo/repositories/EducatorBalanceRepository
 * Data-access layer for the {@link EducatorBalance} model.
 * -------------------------------------------------------------------------
 * `EducatorBalanceRepository` extends `BaseRepository` to inherit generic CRUD,
 * pagination, and typed error handling, then adds educator-balance-specific
 * helpers: balance queries, atomic balance mutations, transaction history,
 * and reconciliation.
 *
 * Field notes (derived from the real EducatorBalance schema):
 *   - `owedStroops`: String — earnings from `platform_collect` settlements,
 *     awaiting payout. This is the withdrawable balance.
 *   - `settledStroops`: String — earnings from `direct` settlements, already
 *     in the educator's Stellar wallet.
 *   - `lastPayoutAt`: Date — when the most recent payout was processed.
 *
 * Transaction history lives in the separate `LedgerEntry` collection (not
 * embedded on EducatorBalance). Reconciliation sums LedgerEntry records and
 * compares against the stored balance fields.
 *
 * All balance mutations use MongoDB atomic operators (`$inc`, `$expr` with
 * aggregation pipeline updates) to prevent lost updates under concurrency.
 *
 * @example
 * import EducatorBalanceRepository from "../mongo/repositories/EducatorBalanceRepository.js";
 *
 * const balance = await EducatorBalanceRepository.findByEducator(educatorId);
 * const available = await EducatorBalanceRepository.getAvailableBalance(educatorId);
 * const deduction = await EducatorBalanceRepository.deductOwedBalance(educatorId, amountStroops);
 */

import BaseRepository, {
  RepositoryValidationError,
} from "../base/BaseRepository.js";
import EducatorBalance from "../../src/models/EducatorBalance.js";
import LedgerEntry from "../../src/models/LedgerEntry.js";

/**
 * Repository exposing EducatorBalance-specific helpers on top of
 * {@link BaseRepository}.
 *
 * Instances are cheap and stateless; a shared default instance is exported so
 * callers can `import EducatorBalanceRepository from ".../EducatorBalanceRepository.js"`
 * and use it immediately, while still allowing `new EducatorBalanceRepository(model)`
 * for tests that need to inject a mock model.
 */
export class EducatorBalanceRepository extends BaseRepository {
  /**
   * @param {import("mongoose").Model} [model=EducatorBalance] The Mongoose model
   *   this repository operates on. Defaults to the real `EducatorBalance` model;
   *   accepting it as a parameter keeps the class testable.
   */
  constructor(model = EducatorBalance) {
    super(model);
  }

  /* ---------------------------------------------------------------------- */
  /* Queries                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Fetch the balance record for a specific educator.
   *
   * @param {import("mongoose").Types.ObjectId|string} educatorId Educator user id.
   * @param {object} [options={}] Query options.
   * @param {boolean} [options.lean=true] Return a plain JS object.
   * @param {(Array|object|string)} [options.populate] Paths to populate.
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The balance document, or `null` if none exists.
   * @throws {RepositoryValidationError} If `educatorId` is missing.
   */
  async findByEducator(educatorId, options = {}) {
    if (!educatorId) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.findByEducator: `educatorId` is required"
      );
    }

    const { lean = true, populate, session, ...rest } = options;

    return this.findOne(
      { educator: educatorId },
      { lean, populate, session, ...rest }
    );
  }

  /**
   * Return the withdrawable/available balance for an educator.
   *
   * "Available" means the amount the platform currently owes the educator
   * and that can be disbursed via a payout batch. This corresponds to the
   * `owedStroops` field on the EducatorBalance document.
   *
   * @param {import("mongoose").Types.ObjectId|string} educatorId Educator user id.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<{stroops: string, amount: string}>} Available balance in
   *   stroops (BigInt string) and USDC decimal string.
   * @throws {RepositoryValidationError} If `educatorId` is missing.
   */
  async getAvailableBalance(educatorId, options = {}) {
    if (!educatorId) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.getAvailableBalance: `educatorId` is required"
      );
    }

    const { session } = options;
    const balance = await this.findByEducator(educatorId, { session });
    const stroops = BigInt(balance?.owedStroops || "0");

    return {
      stroops: stroops.toString(),
      amount: this._stroopsToAmount(stroops),
    };
  }

  /**
   * Return the amount currently pending payout (owed but not yet disbursed).
   *
   * In the current schema, `owedStroops` represents earnings that have been
   * credited from `platform_collect` sales but have not yet been paid out
   * via a payout batch. This is the "pending" amount.
   *
   * @param {import("mongoose").Types.ObjectId|string} educatorId Educator user id.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<{stroops: string, amount: string}>} Pending amount in
   *   stroops (BigInt string) and USDC decimal string.
   * @throws {RepositoryValidationError} If `educatorId` is missing.
   */
  async getPendingAmount(educatorId, options = {}) {
    if (!educatorId) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.getPendingAmount: `educatorId` is required"
      );
    }

    const { session } = options;
    const balance = await this.findByEducator(educatorId, { session });
    const stroops = BigInt(balance?.owedStroops || "0");

    return {
      stroops: stroops.toString(),
      amount: this._stroopsToAmount(stroops),
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Transaction History                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Fetch the educator's ledger/transaction history with pagination.
   *
   * Transaction history lives in the separate `LedgerEntry` collection.
   * Results are scoped to the educator and sorted newest-first by default.
   *
   * @param {import("mongoose").Types.ObjectId|string} educatorId Educator user id.
   * @param {object} [options={}]
   * @param {number} [options.page=1] 1-based page number.
   * @param {number} [options.limit=20] Page size (clamped to 100).
   * @param {string} [options.sortBy="createdAt"] Field to sort by.
   * @param {("asc"|"desc")} [options.order="desc"] Sort direction.
   * @param {string} [options.type] Filter by entry type ("sale" or "payout").
   * @param {Date|string} [options.from] Start date (inclusive).
   * @param {Date|string} [options.to] End date (inclusive).
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<{data: object[], total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   * @throws {RepositoryValidationError} If `educatorId` is missing.
   */
  async getTransactionHistory(educatorId, options = {}) {
    if (!educatorId) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.getTransactionHistory: `educatorId` is required"
      );
    }

    const {
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      order = "desc",
      type,
      from,
      to,
      session,
    } = options;

    const filter = { educator: educatorId };

    if (type) {
      if (!["sale", "payout"].includes(type)) {
        throw new RepositoryValidationError(
          "EducatorBalanceRepository.getTransactionHistory: `type` must be 'sale' or 'payout'"
        );
      }
      filter.type = type;
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const direction = String(order).toLowerCase() === "asc" ? 1 : -1;
    const effectiveLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    const effectivePage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (effectivePage - 1) * effectiveLimit;

    const [data, total] = await Promise.all([
      LedgerEntry.find(filter)
        .sort({ [sortBy]: direction })
        .skip(skip)
        .limit(effectiveLimit)
        .lean(true)
        .session(session ?? null),
      LedgerEntry.countDocuments(filter).session(session ?? null),
    ]);

    const totalPages = Math.ceil(total / effectiveLimit);

    return {
      data,
      total,
      page: effectivePage,
      limit: effectiveLimit,
      totalPages,
      hasNextPage: effectivePage < totalPages,
      hasPrevPage: effectivePage > 1,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Reconciliation                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * Verify that the stored EducatorBalance is consistent with its underlying
   * LedgerEntry transaction history.
   *
   * Reconciliation logic:
   *   - `sale` + `platform_collect` → add `amountStroops` to computed owed
   *   - `sale` + `direct` → add `amountStroops` to computed settled
   *   - `payout` → subtract `amountStroops` from computed owed, add to computed settled
   *
   * @param {import("mongoose").Types.ObjectId|string} educatorId Educator user id.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<{isConsistent: boolean, storedOwed: string, computedOwed: string, storedSettled: string, computedSettled: string, discrepancies: string[]}>}
   * @throws {RepositoryValidationError} If `educatorId` is missing.
   */
  async reconcileBalance(educatorId, options = {}) {
    if (!educatorId) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.reconcileBalance: `educatorId` is required"
      );
    }

    const { session } = options;

    const [balance, entries] = await Promise.all([
      this.findByEducator(educatorId, { session }),
      LedgerEntry.find({ educator: educatorId })
        .sort({ createdAt: 1 })
        .lean(true)
        .session(session ?? null),
    ]);

    let computedOwed = 0n;
    let computedSettled = 0n;

    for (const entry of entries) {
      const amt = BigInt(entry.amountStroops || "0");

      if (entry.type === "sale") {
        if (entry.settlement === "platform_collect") {
          computedOwed += amt;
        } else {
          computedSettled += amt;
        }
      } else if (entry.type === "payout") {
        computedOwed -= amt;
        computedSettled += amt;
      }
    }

    const storedOwed = BigInt(balance?.owedStroops || "0");
    const storedSettled = BigInt(balance?.settledStroops || "0");

    const discrepancies = [];
    if (storedOwed !== computedOwed) {
      discrepancies.push(
        `owedStroops mismatch: stored=${storedOwed.toString()}, computed=${computedOwed.toString()}`
      );
    }
    if (storedSettled !== computedSettled) {
      discrepancies.push(
        `settledStroops mismatch: stored=${storedSettled.toString()}, computed=${computedSettled.toString()}`
      );
    }

    return {
      isConsistent: discrepancies.length === 0,
      storedOwed: storedOwed.toString(),
      computedOwed: computedOwed.toString(),
      storedSettled: storedSettled.toString(),
      computedSettled: computedSettled.toString(),
      discrepancies,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Atomic Balance Mutations                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Atomically deduct from an educator's owed balance.
   *
   * Uses a MongoDB aggregation pipeline update with an `$expr` filter so the
   * balance check and deduction happen in a single atomic operation. If the
   * available balance is insufficient, the update matches nothing and returns
   * `null` — preventing any race condition from pushing the balance negative.
   *
   * @param {import("mongoose").Types.ObjectId|string} educatorId Educator user id.
   * @param {string|bigint} amountStroops Amount to deduct (in stroops).
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The updated balance document, or `null` if
   *   the educator has insufficient owed balance.
   * @throws {RepositoryValidationError} If `educatorId` or `amountStroops` is missing/invalid.
   */
  async deductOwedBalance(educatorId, amountStroops, options = {}) {
    if (!educatorId) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.deductOwedBalance: `educatorId` is required"
      );
    }

    const amount = BigInt(amountStroops);
    if (amount <= 0n) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.deductOwedBalance: `amountStroops` must be a positive integer"
      );
    }

    const { session } = options;
    const amountNum = Number(amount);

    const result = await this.model.findOneAndUpdate(
      {
        educator: educatorId,
        $expr: { $gte: [{ $toLong: "$owedStroops" }, amountNum] },
      },
      [
        {
          $set: {
            owedStroops: {
              $toString: {
                $subtract: [{ $toLong: "$owedStroops" }, amountNum],
              },
            },
            lastPayoutAt: new Date(),
          },
        },
      ],
      { new: true, session: session ?? null }
    );

    return result;
  }

  /**
   * Atomically credit an educator's owed balance.
   *
   * Uses an aggregation pipeline update with `$add` on `$toLong` to atomically
   * increment the string-stored stroops value. Creates the balance record if
   * it does not exist (upsert).
   *
   * @param {import("mongoose").Types.ObjectId|string} educatorId Educator user id.
   * @param {string|bigint} amountStroops Amount to credit (in stroops).
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object>} The updated (or created) balance document.
   * @throws {RepositoryValidationError} If `educatorId` or `amountStroops` is missing/invalid.
   */
  async creditOwedBalance(educatorId, amountStroops, options = {}) {
    if (!educatorId) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.creditOwedBalance: `educatorId` is required"
      );
    }

    const amount = BigInt(amountStroops);
    if (amount <= 0n) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.creditOwedBalance: `amountStroops` must be a positive integer"
      );
    }

    const { session } = options;
    const amountNum = Number(amount);

    const result = await this.model.findOneAndUpdate(
      { educator: educatorId },
      [
        {
          $set: {
            owedStroops: {
              $toString: {
                $add: [{ $toLong: { $ifNull: ["$owedStroops", "0"] } }, amountNum],
              },
            },
          },
        },
      ],
      { upsert: true, new: true, session: session ?? null }
    );

    return result;
  }

  /**
   * Atomically move an amount from owed to settled balance.
   *
   * The filter checks that `owedStroops >= amount` using `$expr`, and the
   * aggregation pipeline update subtracts from owed and adds to settled — all
   * in a single atomic MongoDB operation.
   *
   * @param {import("mongoose").Types.ObjectId|string} educatorId Educator user id.
   * @param {string|bigint} amountStroops Amount to move (in stroops).
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The updated balance document, or `null` if
   *   the educator has insufficient owed balance.
   * @throws {RepositoryValidationError} If `educatorId` or `amountStroops` is missing/invalid.
   */
  async settleOwedToSettled(educatorId, amountStroops, options = {}) {
    if (!educatorId) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.settleOwedToSettled: `educatorId` is required"
      );
    }

    const amount = BigInt(amountStroops);
    if (amount <= 0n) {
      throw new RepositoryValidationError(
        "EducatorBalanceRepository.settleOwedToSettled: `amountStroops` must be a positive integer"
      );
    }

    const { session } = options;
    const amountNum = Number(amount);

    const result = await this.model.findOneAndUpdate(
      {
        educator: educatorId,
        $expr: { $gte: [{ $toLong: "$owedStroops" }, amountNum] },
      },
      [
        {
          $set: {
            owedStroops: {
              $toString: {
                $subtract: [{ $toLong: "$owedStroops" }, amountNum],
              },
            },
            settledStroops: {
              $toString: {
                $add: [
                  { $toLong: { $ifNull: ["$settledStroops", "0"] } },
                  amountNum,
                ],
              },
            },
            lastPayoutAt: new Date(),
          },
        },
      ],
      { new: true, session: session ?? null }
    );

    return result;
  }

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Convert a stroops (BigInt) amount to a USDC decimal string.
   * 1 USDC = 100,000,000 stroops (8 decimal places).
   *
   * @private
   * @param {bigint} stroops
   * @returns {string} USDC decimal string.
   */
  _stroopsToAmount(stroops) {
    const str = stroops.toString();
    if (str === "0") return "0";

    const negative = str.startsWith("-");
    const abs = negative ? str.slice(1) : str;

    if (abs.length <= 8) {
      const padded = abs.padStart(8, "0");
      const result = `0.${padded}`.replace(/0+$/, "").replace(/\.$/, ".0");
      return negative ? `-${result}` : result;
    }

    const intPart = abs.slice(0, abs.length - 8);
    const decPart = abs.slice(abs.length - 8).replace(/0+$/, "");
    const result = decPart ? `${intPart}.${decPart}` : intPart;
    return negative ? `-${result}` : result;
  }
}

/**
 * Default shared instance bound to the real `EducatorBalance` model, mirroring
 * the ergonomics the other `/mongo` exports aim for.
 * @type {EducatorBalanceRepository}
 */
const educatorBalanceRepository = new EducatorBalanceRepository();

export default educatorBalanceRepository;
