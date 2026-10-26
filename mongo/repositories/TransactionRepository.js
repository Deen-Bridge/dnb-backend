/**
 * @module mongo/repositories/TransactionRepository
 * Data-access layer for the {@link Transaction} model (#170).
 * -------------------------------------------------------------------------
 * `TransactionRepository` centralizes every Transaction-specific persistence
 * query so route handlers and services stop talking to the Mongoose model
 * directly.
 *
 * Conventions:
 *   - Repositories never touch `res`/express - they return data or throw.
 *   - Every exported method carries complete JSDoc.
 *
 * Index recommendations (for optimal query performance):
 *   - { buyer: 1, status: 1 }              - findByUser with status filter
 *   - { creator: 1, status: 1 }            - findByCreator queries
 *   - { status: 1, createdAt: -1 }         - findByStatus with date sort
 *   - { type: 1, status: 1, createdAt: -1 } - donation stats
 *   - { createdAt: 1 }                     - date range queries
 *   - { confirmedAt: 1 }                   - settlement/payout queries
 *
 * @example
 * import TransactionRepository from "../mongo/repositories/TransactionRepository.js";
 *
 * const txns = await TransactionRepository.findByUser(userId, { status: "confirmed" });
 * const stats = await TransactionRepository.getVolumeStats({ from: startDate, to: endDate });
 */

import Transaction from "../../src/models/Transaction.js";

/**
 * @typedef {Object} QueryOptions
 * @property {number} [limit]           Maximum number of documents to return.
 * @property {number} [skip]            Number of documents to skip (offset).
 * @property {number} [page]            1-based page number; combined with
 *                                      `limit` to compute `skip` when `skip`
 *                                      is not supplied explicitly.
 * @property {Object|string} [sort]     Mongoose sort specification.
 * @property {string|string[]|Object|Object[]} [populate]
 *                                      Path(s) to populate.
 * @property {string|Object} [select]   Projection / field selection.
 * @property {boolean} [lean=false]     Return plain objects instead of
 *                                      hydrated Mongoose documents.
 */

/**
 * Repository exposing Transaction-specific query helpers on top of the
 * Mongoose `Transaction` model.
 */
export class TransactionRepository {
  /**
   * @param {import("mongoose").Model} [model=Transaction] The Mongoose model
   *   this repository operates on.
   */
  constructor(model = Transaction) {
    /**
     * The Mongoose model backing this repository.
     * @type {import("mongoose").Model}
     */
    this.model = model;
  }

  /**
   * Apply shared {@link QueryOptions} to an existing Mongoose query.
   *
   * @private
   * @param {import("mongoose").Query} query   The query to decorate.
   * @param {QueryOptions} [options={}]         Options to apply.
   * @returns {import("mongoose").Query} The same query, decorated.
   */
  _applyOptions(query, options = {}) {
    const { limit, skip, page, sort, populate, select, lean } = options;

    if (sort) query.sort(sort);
    if (select) query.select(select);

    let effectiveSkip = skip;
    if (effectiveSkip == null && page != null && limit != null) {
      effectiveSkip = (Math.max(1, page) - 1) * limit;
    }
    if (effectiveSkip != null) query.skip(effectiveSkip);
    if (limit != null) query.limit(limit);

    if (populate) {
      const paths = Array.isArray(populate) ? populate : [populate];
      for (const path of paths) query.populate(path);
    }

    if (lean) query.lean();

    return query;
  }

  /**
   * Fetch a single transaction by its identifier.
   *
   * @param {import("mongoose").Types.ObjectId|string} id Transaction id.
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object|null>} The transaction, or `null` if not found.
   * @throws {Error} If `id` is missing.
   */
  async findById(id, options = {}) {
    if (!id) throw new Error("TransactionRepository.findById: `id` is required");
    return this._applyOptions(this.model.findById(id), options).exec();
  }

  /**
   * Find a transaction by its Stellar transaction hash.
   *
   * @param {string} hash Stellar transaction hash.
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object|null>} The transaction, or `null` if not found.
   * @throws {Error} If `hash` is missing.
   */
  async findByHash(hash, options = {}) {
    if (!hash) {
      throw new Error("TransactionRepository.findByHash: `hash` is required");
    }
    const query = this.model.findOne({ stellarTxHash: hash });
    return this._applyOptions(query, options).exec();
  }

  /**
   * Find all transactions for a given user (as buyer).
   *
   * @param {import("mongoose").Types.ObjectId|string} userId The buyer's User id.
   * @param {QueryOptions & { status?: string|string[], type?: string }} [options={}]
   *   `status` filters by transaction status, `type` filters by "purchase"/"donation".
   * @returns {Promise<Object[]>} Matching transactions (newest first by default).
   * @throws {Error} If `userId` is missing.
   */
  async findByUser(userId, options = {}) {
    if (!userId) {
      throw new Error("TransactionRepository.findByUser: `userId` is required");
    }
    const { status, type, ...queryOptions } = options;
    const filter = { buyer: userId };
    if (status) {
      filter.status = Array.isArray(status) ? { $in: status } : status;
    }
    if (type) filter.type = type;

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { createdAt: -1 }, ...queryOptions }).exec();
  }

  /**
   * Find all transactions for a given creator (as seller/recipient).
   *
   * @param {import("mongoose").Types.ObjectId|string} creatorId The creator's User id.
   * @param {QueryOptions & { status?: string|string[], type?: string }} [options={}]
   * @returns {Promise<Object[]>} Matching transactions.
   * @throws {Error} If `creatorId` is missing.
   */
  async findByCreator(creatorId, options = {}) {
    if (!creatorId) {
      throw new Error("TransactionRepository.findByCreator: `creatorId` is required");
    }
    const { status, type, ...queryOptions } = options;
    const filter = { creator: creatorId };
    if (status) {
      filter.status = Array.isArray(status) ? { $in: status } : status;
    }
    if (type) filter.type = type;

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { createdAt: -1 }, ...queryOptions }).exec();
  }

  /**
   * Find transactions by status.
   *
   * @param {string|string[]} status Status or statuses to filter by.
   * @param {QueryOptions & { type?: string }} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching transactions.
   * @throws {Error} If `status` is missing.
   */
  async findByStatus(status, options = {}) {
    if (!status) {
      throw new Error("TransactionRepository.findByStatus: `status` is required");
    }
    const { type, ...queryOptions } = options;
    const filter = {
      status: Array.isArray(status) ? { $in: status } : status,
    };
    if (type) filter.type = type;

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { createdAt: -1 }, ...queryOptions }).exec();
  }

  /**
   * Find transactions within a date range.
   *
   * @param {Date} from Start date (inclusive).
   * @param {Date} to End date (inclusive).
   * @param {QueryOptions & { status?: string|string[], type?: string, dateField?: string }} [options={}]
   *   `dateField` specifies which date field to filter on (default: "createdAt").
   * @returns {Promise<Object[]>} Matching transactions.
   * @throws {Error} If date range is invalid.
   */
  async findByDateRange(from, to, options = {}) {
    if (!from || !to) {
      throw new Error("TransactionRepository.findByDateRange: `from` and `to` are required");
    }
    const { status, type, dateField = "createdAt", ...queryOptions } = options;
    const filter = {
      [dateField]: { $gte: from, $lte: to },
    };
    if (status) {
      filter.status = Array.isArray(status) ? { $in: status } : status;
    }
    if (type) filter.type = type;

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { [dateField]: -1 }, ...queryOptions }).exec();
  }

  /**
   * Find transactions for a specific item (book or course).
   *
   * @param {string} itemType "book" or "course".
   * @param {import("mongoose").Types.ObjectId|string} itemId The item's id.
   * @param {QueryOptions & { status?: string|string[] }} [options={}]
   * @returns {Promise<Object[]>} Matching transactions.
   */
  async findByItem(itemType, itemId, options = {}) {
    if (!itemType || !itemId) {
      throw new Error("TransactionRepository.findByItem: `itemType` and `itemId` are required");
    }
    const { status, ...queryOptions } = options;
    const filter = { itemType, itemId };
    if (status) {
      filter.status = Array.isArray(status) ? { $in: status } : status;
    }

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { createdAt: -1 }, ...queryOptions }).exec();
  }

  /**
   * Find pending transactions that need processing/retry.
   *
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object[]>} Pending/retrying transactions.
   */
  async findPending(options = {}) {
    const filter = { status: { $in: ["pending", "submitted", "retrying"] } };
    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { createdAt: 1 }, ...options }).exec();
  }

  /**
   * Find failed transactions for review.
   *
   * @param {QueryOptions & { since?: Date }} [options={}] Query options.
   *   `since` limits to failures after a specific date.
   * @returns {Promise<Object[]>} Failed transactions.
   */
  async findFailed(options = {}) {
    const { since, ...queryOptions } = options;
    const filter = { status: "failed" };
    if (since) filter.createdAt = { $gte: since };

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { createdAt: -1 }, ...queryOptions }).exec();
  }

  // -------------------------------------------------------------------------
  // Aggregation and statistics methods
  // -------------------------------------------------------------------------

  /**
   * Get transaction volume statistics.
   *
   * @param {Object} [options={}]
   * @param {Date} [options.from] Start date.
   * @param {Date} [options.to] End date.
   * @param {string} [options.type] Filter by transaction type.
   * @param {string} [options.currency] Filter by currency.
   * @param {string|string[]} [options.status=["confirmed"]] Status filter.
   * @returns {Promise<Object>} Volume statistics.
   */
  async getVolumeStats(options = {}) {
    const {
      from,
      to,
      type,
      currency,
      status = ["confirmed"],
    } = options;

    const match = {
      status: Array.isArray(status) ? { $in: status } : status,
    };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }
    if (type) match.type = type;
    if (currency) match.currency = currency;

    const result = await this.model.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalCount: { $sum: 1 },
          totalVolume: { $sum: { $toDouble: "$amount" } },
          avgAmount: { $avg: { $toDouble: "$amount" } },
          minAmount: { $min: { $toDouble: "$amount" } },
          maxAmount: { $max: { $toDouble: "$amount" } },
        },
      },
    ]);

    return result[0] || {
      totalCount: 0,
      totalVolume: 0,
      avgAmount: 0,
      minAmount: 0,
      maxAmount: 0,
    };
  }

  /**
   * Get volume breakdown by currency.
   *
   * @param {Object} [options={}]
   * @param {Date} [options.from] Start date.
   * @param {Date} [options.to] End date.
   * @param {string|string[]} [options.status=["confirmed"]] Status filter.
   * @returns {Promise<Object[]>} Per-currency volume breakdown.
   */
  async getVolumeByCurrency(options = {}) {
    const { from, to, status = ["confirmed"] } = options;

    const match = {
      status: Array.isArray(status) ? { $in: status } : status,
    };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    return this.model.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$currency",
          count: { $sum: 1 },
          volume: { $sum: { $toDouble: "$amount" } },
        },
      },
      { $sort: { volume: -1 } },
    ]);
  }

  /**
   * Get volume breakdown by transaction type.
   *
   * @param {Object} [options={}]
   * @param {Date} [options.from] Start date.
   * @param {Date} [options.to] End date.
   * @param {string|string[]} [options.status=["confirmed"]] Status filter.
   * @returns {Promise<Object[]>} Per-type volume breakdown.
   */
  async getVolumeByType(options = {}) {
    const { from, to, status = ["confirmed"] } = options;

    const match = {
      status: Array.isArray(status) ? { $in: status } : status,
    };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    return this.model.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          volume: { $sum: { $toDouble: "$amount" } },
        },
      },
      { $sort: { volume: -1 } },
    ]);
  }

  /**
   * Get daily transaction volume time series.
   *
   * @param {Object} options
   * @param {Date} options.from Start date.
   * @param {Date} options.to End date.
   * @param {string} [options.type] Filter by transaction type.
   * @param {string|string[]} [options.status=["confirmed"]] Status filter.
   * @returns {Promise<Object[]>} Daily volume series.
   */
  async getDailyVolume(options = {}) {
    const { from, to, type, status = ["confirmed"] } = options;

    if (!from || !to) {
      throw new Error("TransactionRepository.getDailyVolume: `from` and `to` are required");
    }

    const match = {
      createdAt: { $gte: from, $lte: to },
      status: Array.isArray(status) ? { $in: status } : status,
    };
    if (type) match.type = type;

    return this.model.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          },
          count: { $sum: 1 },
          volume: { $sum: { $toDouble: "$amount" } },
        },
      },
      {
        $project: {
          _id: 0,
          date: {
            $dateFromParts: {
              year: "$_id.year",
              month: "$_id.month",
              day: "$_id.day",
            },
          },
          count: 1,
          volume: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);
  }

  /**
   * Get transaction count breakdown by status.
   *
   * @param {Object} [options={}]
   * @param {Date} [options.from] Start date.
   * @param {Date} [options.to] End date.
   * @returns {Promise<Object[]>} Per-status count breakdown.
   */
  async getCountByStatus(options = {}) {
    const { from, to } = options;
    const match = {};
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    const pipeline = [];
    if (Object.keys(match).length > 0) {
      pipeline.push({ $match: match });
    }
    pipeline.push(
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    );

    return this.model.aggregate(pipeline);
  }

  /**
   * Get earnings summary for a creator.
   *
   * @param {import("mongoose").Types.ObjectId|string} creatorId Creator's User id.
   * @param {Object} [options={}]
   * @param {Date} [options.from] Start date.
   * @param {Date} [options.to] End date.
   * @returns {Promise<Object>} Earnings summary with total and breakdown.
   */
  async getCreatorEarnings(creatorId, options = {}) {
    if (!creatorId) {
      throw new Error("TransactionRepository.getCreatorEarnings: `creatorId` is required");
    }
    const { from, to } = options;

    const match = {
      creator: creatorId,
      status: "confirmed",
    };
    if (from || to) {
      match.confirmedAt = {};
      if (from) match.confirmedAt.$gte = from;
      if (to) match.confirmedAt.$lte = to;
    }

    const result = await this.model.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$itemType",
          count: { $sum: 1 },
          gross: { $sum: { $toDouble: "$amount" } },
          net: {
            $sum: {
              $cond: [
                { $ifNull: ["$platformFee.creatorAmount", false] },
                { $toDouble: "$platformFee.creatorAmount" },
                { $toDouble: "$amount" },
              ],
            },
          },
        },
      },
    ]);

    const totals = result.reduce(
      (acc, r) => {
        acc.totalCount += r.count;
        acc.totalGross += r.gross;
        acc.totalNet += r.net;
        return acc;
      },
      { totalCount: 0, totalGross: 0, totalNet: 0 }
    );

    return {
      ...totals,
      byItemType: result,
    };
  }

  /**
   * Count transactions matching an arbitrary filter.
   *
   * @param {Object} [filter={}] A Mongoose filter object.
   * @returns {Promise<number>} The matching document count.
   */
  async count(filter = {}) {
    return this.model.countDocuments(filter).exec();
  }
}

/**
 * Default shared instance bound to the real `Transaction` model.
 * @type {TransactionRepository}
 */
const transactionRepository = new TransactionRepository();

export default transactionRepository;
