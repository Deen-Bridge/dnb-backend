/**
 * @module mongo/repositories/RefundRepository
 * @description Repository for Refund model database operations. Provides
 * methods for querying refunds by status, user, transaction, and processing
 * refund workflows with audit trail support.
 */

import BaseRepository from "../base/BaseRepository.js";
import Refund from "../../src/models/Refund.js";

/**
 * Repository for Refund model operations.
 *
 * Extends BaseRepository with refund-specific query methods for:
 * - Finding refunds by transaction, buyer, educator
 * - Querying pending and active refunds
 * - Processing refund status transitions
 * - Generating refund statistics and reports
 *
 * @example
 * const refundRepo = new RefundRepository();
 * const pending = await refundRepo.findPending({ limit: 50 });
 * const stats = await refundRepo.getStatistics({ startDate, endDate });
 */
export default class RefundRepository extends BaseRepository {
  constructor() {
    super(Refund);
  }

  /* -------------------------------------------------------------------------- */
  /* Refund-specific queries                                                    */
  /* -------------------------------------------------------------------------- */

  /**
   * Find a refund by its associated original transaction.
   *
   * @param {string|import("mongoose").Types.ObjectId} transactionId - The original transaction ID.
   * @param {object} [options]
   * @param {string|object} [options.select] - Projection.
   * @param {(Array|object|string)} [options.populate] - Paths to populate.
   * @param {boolean} [options.lean=false] - Return plain JS object.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|object|null>} The refund or null.
   */
  async findByTransaction(transactionId, options = {}) {
    return this.findOne({ originalTransaction: transactionId }, options);
  }

  /**
   * Find all refunds for a specific buyer.
   *
   * @param {string|import("mongoose").Types.ObjectId} buyerId - The buyer's user ID.
   * @param {object} [options] - Pagination and query options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findByBuyer(buyerId, options = {}) {
    return this.paginate({ buyer: buyerId }, {
      sortBy: "createdAt",
      order: "desc",
      ...options,
    });
  }

  /**
   * Find all refunds for a specific educator.
   *
   * @param {string|import("mongoose").Types.ObjectId} educatorId - The educator's user ID.
   * @param {object} [options] - Pagination and query options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findByEducator(educatorId, options = {}) {
    return this.paginate({ educator: educatorId }, {
      sortBy: "createdAt",
      order: "desc",
      ...options,
    });
  }

  /**
   * Find all pending refund requests awaiting review.
   *
   * @param {object} [options] - Pagination and query options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findPending(options = {}) {
    return this.paginate({ status: "requested" }, {
      sortBy: "createdAt",
      order: "asc", // oldest first for FIFO processing
      populate: [
        { path: "buyer", select: "name email" },
        { path: "educator", select: "name email" },
        { path: "originalTransaction", select: "amount itemType itemTitle" },
      ],
      ...options,
    });
  }

  /**
   * Find refunds by status.
   *
   * @param {string|string[]} status - Status or array of statuses to filter by.
   * @param {object} [options] - Pagination and query options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findByStatus(status, options = {}) {
    const filter = Array.isArray(status)
      ? { status: { $in: status } }
      : { status };
    return this.paginate(filter, {
      sortBy: "createdAt",
      order: "desc",
      ...options,
    });
  }

  /**
   * Find active (non-terminal) refunds that require attention.
   * Active statuses: requested, approved, submitted, disputed
   *
   * @param {object} [options] - Pagination and query options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findActive(options = {}) {
    return this.findByStatus(
      ["requested", "approved", "submitted", "disputed"],
      options
    );
  }

  /**
   * Find refunds that are in disputed status requiring resolution.
   *
   * @param {object} [options] - Pagination and query options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findDisputed(options = {}) {
    return this.paginate({ status: "disputed" }, {
      sortBy: "createdAt",
      order: "asc",
      populate: [
        { path: "buyer", select: "name email" },
        { path: "educator", select: "name email" },
        { path: "originalTransaction" },
      ],
      ...options,
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Refund workflow operations                                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * Approve a pending refund request.
   *
   * @param {string|import("mongoose").Types.ObjectId} refundId - The refund ID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated refund.
   */
  async approve(refundId, options = {}) {
    return this.update(
      refundId,
      { status: "approved" },
      { session: options.session }
    );
  }

  /**
   * Reject a pending refund request with reason.
   *
   * @param {string|import("mongoose").Types.ObjectId} refundId - The refund ID.
   * @param {string} reason - Rejection reason.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated refund.
   */
  async reject(refundId, reason, options = {}) {
    return this.update(
      refundId,
      { status: "rejected", rejectionReason: reason },
      { session: options.session }
    );
  }

  /**
   * Mark refund as submitted to blockchain.
   *
   * @param {string|import("mongoose").Types.ObjectId} refundId - The refund ID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated refund.
   */
  async markSubmitted(refundId, options = {}) {
    return this.update(
      refundId,
      { status: "submitted" },
      { session: options.session }
    );
  }

  /**
   * Confirm a refund with on-chain transaction details.
   *
   * @param {string|import("mongoose").Types.ObjectId} refundId - The refund ID.
   * @param {object} txDetails - Transaction details from blockchain.
   * @param {string} txDetails.txHash - Stellar transaction hash.
   * @param {number} [txDetails.ledger] - Stellar ledger number.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated refund.
   */
  async confirm(refundId, txDetails, options = {}) {
    return this.update(
      refundId,
      {
        status: "confirmed",
        refundTxHash: txDetails.txHash,
        refundLedger: txDetails.ledger,
      },
      { session: options.session }
    );
  }

  /**
   * Mark refund as failed with reason.
   *
   * @param {string|import("mongoose").Types.ObjectId} refundId - The refund ID.
   * @param {string} [reason] - Failure reason.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated refund.
   */
  async markFailed(refundId, reason, options = {}) {
    return this.update(
      refundId,
      { status: "failed", rejectionReason: reason },
      { session: options.session }
    );
  }

  /**
   * Resolve a disputed refund with final decision.
   *
   * @param {string|import("mongoose").Types.ObjectId} refundId - The refund ID.
   * @param {object} resolution - Resolution details.
   * @param {("approved"|"rejected"|"off_chain_resolved")} resolution.decision - Final decision.
   * @param {string} [resolution.notes] - Resolution notes.
   * @param {string|import("mongoose").Types.ObjectId} resolution.resolvedBy - Admin user ID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated refund.
   */
  async resolve(refundId, resolution, options = {}) {
    const newStatus = resolution.decision === "approved" ? "approved" : "resolved";
    return this.update(
      refundId,
      {
        status: newStatus,
        resolution: {
          decision: resolution.decision,
          notes: resolution.notes,
          resolvedBy: resolution.resolvedBy,
          resolvedAt: new Date(),
        },
      },
      { session: options.session }
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Statistics and reporting                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * Get refund statistics for a date range.
   *
   * @param {object} [options]
   * @param {Date} [options.startDate] - Start of date range.
   * @param {Date} [options.endDate] - End of date range.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<object>} Statistics object with counts and amounts.
   */
  async getStatistics(options = {}) {
    const { startDate, endDate, session } = options;
    const dateFilter = {};
    if (startDate) dateFilter.$gte = startDate;
    if (endDate) dateFilter.$lte = endDate;

    const matchStage = Object.keys(dateFilter).length > 0
      ? { createdAt: dateFilter }
      : {};

    const stats = await this.model.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]).session(session ?? null);

    const result = {
      total: 0,
      totalAmount: 0,
      byStatus: {},
    };

    for (const stat of stats) {
      result.byStatus[stat._id] = {
        count: stat.count,
        amount: stat.totalAmount,
      };
      result.total += stat.count;
      result.totalAmount += stat.totalAmount;
    }

    return result;
  }

  /**
   * Get refund statistics grouped by item type.
   *
   * @param {object} [options]
   * @param {Date} [options.startDate] - Start of date range.
   * @param {Date} [options.endDate] - End of date range.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<object>} Statistics grouped by item type.
   */
  async getStatisticsByItemType(options = {}) {
    const { startDate, endDate, session } = options;
    const dateFilter = {};
    if (startDate) dateFilter.$gte = startDate;
    if (endDate) dateFilter.$lte = endDate;

    const matchStage = Object.keys(dateFilter).length > 0
      ? { createdAt: dateFilter }
      : {};

    const stats = await this.model.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { itemType: "$itemType", status: "$status" },
          count: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]).session(session ?? null);

    const result = {
      book: { total: 0, totalAmount: 0, byStatus: {} },
      course: { total: 0, totalAmount: 0, byStatus: {} },
    };

    for (const stat of stats) {
      const itemType = stat._id.itemType;
      const status = stat._id.status;
      if (result[itemType]) {
        result[itemType].byStatus[status] = {
          count: stat.count,
          amount: stat.totalAmount,
        };
        result[itemType].total += stat.count;
        result[itemType].totalAmount += stat.totalAmount;
      }
    }

    return result;
  }

  /**
   * Get average resolution time for completed refunds.
   *
   * @param {object} [options]
   * @param {Date} [options.startDate] - Start of date range.
   * @param {Date} [options.endDate] - End of date range.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{avgResolutionTimeMs: number, avgResolutionTimeHours: number, count: number}>}
   */
  async getAverageResolutionTime(options = {}) {
    const { startDate, endDate, session } = options;
    const matchStage = {
      status: { $in: ["confirmed", "rejected", "resolved"] },
      "resolution.resolvedAt": { $exists: true },
    };

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }

    const result = await this.model.aggregate([
      { $match: matchStage },
      {
        $project: {
          resolutionTime: {
            $subtract: ["$resolution.resolvedAt", "$createdAt"],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgResolutionTimeMs: { $avg: "$resolutionTime" },
          count: { $sum: 1 },
        },
      },
    ]).session(session ?? null);

    if (result.length === 0) {
      return { avgResolutionTimeMs: 0, avgResolutionTimeHours: 0, count: 0 };
    }

    const avgMs = result[0].avgResolutionTimeMs;
    return {
      avgResolutionTimeMs: avgMs,
      avgResolutionTimeHours: avgMs / (1000 * 60 * 60),
      count: result[0].count,
    };
  }

  /**
   * Find refunds approaching expiration deadline.
   *
   * @param {number} [hoursUntilExpiry=24] - Hours until expiry to consider.
   * @param {object} [options] - Query options.
   * @returns {Promise<Array>} Refunds near expiration.
   */
  async findNearExpiration(hoursUntilExpiry = 24, options = {}) {
    const deadline = new Date(Date.now() + hoursUntilExpiry * 60 * 60 * 1000);
    return this.findMany(
      {
        status: { $in: ["requested", "approved"] },
        expiresAt: { $lte: deadline, $gt: new Date() },
      },
      {
        sort: { expiresAt: 1 },
        populate: [
          { path: "buyer", select: "name email" },
          { path: "educator", select: "name email" },
        ],
        ...options,
      }
    );
  }
}
