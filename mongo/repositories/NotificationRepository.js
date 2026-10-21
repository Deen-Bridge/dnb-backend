/**
 * @module mongo/repositories/NotificationRepository
 * Data-access layer for the {@link Notification} model.
 * -------------------------------------------------------------------------
 * `NotificationRepository` extends `BaseRepository` to inherit generic CRUD,
 * offset/cursor pagination, and typed error handling, then adds
 * notification-specific query helpers: user scoping, unread filtering,
 * mark-as-read mutations, bulk operations, and type/priority filtering.
 *
 * @example
 * import NotificationRepository from "../mongo/repositories/NotificationRepository.js";
 *
 * const unread = await NotificationRepository.findUnread(userId, { limit: 25 });
 * await NotificationRepository.markAsRead(notificationId);
 * await NotificationRepository.markAllAsRead(userId);
 */

import BaseRepository, { RepositoryValidationError } from "../base/BaseRepository.js";
import Notification from "../../src/models/Notification.js";

/**
 * Allowed values for {@link NotificationRepository#type | type} field.
 * Mirrors the `type` enum defined on the Notification schema.
 * @type {ReadonlyArray<string>}
 */
export const NOTIFICATION_TYPES = Object.freeze([
  "follow",
  "unfollow",
  "new_course",
  "new_book",
  "course_like",
  "book_like",
  "course_comment",
  "book_comment",
  "system",
  "welcome",
  "recommendation",
  "pledge_due",
]);

/**
 * Allowed values for the `priority` field.
 * Mirrors the `priority` enum defined on the Notification schema.
 * @type {ReadonlyArray<string>}
 */
export const NOTIFICATION_PRIORITIES = Object.freeze([
  "low",
  "medium",
  "high",
  "urgent",
]);

/**
 * Repository exposing Notification-specific query helpers on top of
 * {@link BaseRepository}.
 *
 * Instances are cheap and stateless; a shared default instance is exported so
 * callers can `import NotificationRepository from ".../NotificationRepository.js"`
 * and use it immediately, while still allowing `new NotificationRepository(model)`
 * for tests that need to inject a mock model.
 */
export class NotificationRepository extends BaseRepository {
  /**
   * @param {import("mongoose").Model} [model=Notification] The Mongoose model
   *   this repository operates on. Defaults to the real `Notification` model;
   *   accepting it as a parameter keeps the class testable.
   */
  constructor(model = Notification) {
    super(model);
  }

  /* ---------------------------------------------------------------------- */
  /* Queries                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Fetch notifications belonging to a specific user (as recipient).
   *
   * Deleted notifications (`isDeleted: true`) are excluded by default.
   *
   * @param {import("mongoose").Types.ObjectId|string} userId Recipient user id.
   * @param {object} [options={}] Query options forwarded to
   *   {@link BaseRepository#paginate} or {@link BaseRepository#findMany}.
   * @param {boolean} [options.paginate=false] When `true`, returns offset-paginated
   *   results via {@link BaseRepository#paginate}. Otherwise returns a plain array.
   * @param {object} [options.filter] Additional filter criteria merged into the
   *   base `{ recipient, isDeleted: false }` query (e.g. `{ type: "follow" }`).
   * @returns {Promise<object[]|{data: object[], total: number, ...}>} Matching
   *   notifications, newest first by default.
   * @throws {RepositoryValidationError} If `userId` is missing.
   */
  async findByUser(userId, options = {}) {
    if (!userId) {
      throw new RepositoryValidationError(
        "NotificationRepository.findByUser: `userId` is required"
      );
    }

    const { paginate: usePaginate, filter: extraFilter, ...rest } = options;
    const filter = {
      recipient: userId,
      isDeleted: false,
      ...extraFilter,
    };

    const defaults = { sort: { createdAt: -1 }, ...rest };

    if (usePaginate) {
      return this.paginate(filter, defaults);
    }

    return this.findMany(filter, defaults);
  }

  /**
   * Fetch unread notifications for a user.
   *
   * Uses the `isRead: false` field from the Notification schema.
   *
   * @param {import("mongoose").Types.ObjectId|string} userId Recipient user id.
   * @param {object} [options={}] Query options (same shape as
   *   {@link NotificationRepository#findByUser}).
   * @returns {Promise<object[]|{data: object[], total: number, ...}>} Unread
   *   notifications, newest first by default.
   * @throws {RepositoryValidationError} If `userId` is missing.
   */
  async findUnread(userId, options = {}) {
    if (!userId) {
      throw new RepositoryValidationError(
        "NotificationRepository.findUnread: `userId` is required"
      );
    }

    return this.findByUser(userId, {
      ...options,
      filter: { isRead: false, ...options.filter },
    });
  }

  /**
   * Query notifications filtered by type.
   *
   * @param {string} type Notification type (must be a valid enum value).
   * @param {object} [options={}] Query options. Supports an optional `userId`
   *   to scope results to a single recipient.
   * @returns {Promise<object[]>} Matching notifications.
   * @throws {RepositoryValidationError} If `type` is missing or invalid.
   */
  async findByType(type, options = {}) {
    if (!type) {
      throw new RepositoryValidationError(
        "NotificationRepository.findByType: `type` is required"
      );
    }

    if (!NOTIFICATION_TYPES.includes(type)) {
      throw new RepositoryValidationError(
        `NotificationRepository.findByType: invalid type "${type}". Must be one of: ${NOTIFICATION_TYPES.join(", ")}`
      );
    }

    const { userId, ...rest } = options;

    if (userId) {
      return this.findByUser(userId, {
        ...rest,
        filter: { type, ...rest.filter },
      });
    }

    const filter = { type, isDeleted: false, ...rest.filter };
    return this.findMany(filter, { sort: { createdAt: -1 }, ...rest });
  }

  /**
   * Query notifications filtered by priority.
   *
   * @param {string} priority Notification priority (must be a valid enum value).
   * @param {object} [options={}] Query options. Supports an optional `userId`
   *   to scope results to a single recipient.
   * @returns {Promise<object[]>} Matching notifications.
   * @throws {RepositoryValidationError} If `priority` is missing or invalid.
   */
  async findByPriority(priority, options = {}) {
    if (!priority) {
      throw new RepositoryValidationError(
        "NotificationRepository.findByPriority: `priority` is required"
      );
    }

    if (!NOTIFICATION_PRIORITIES.includes(priority)) {
      throw new RepositoryValidationError(
        `NotificationRepository.findByPriority: invalid priority "${priority}". Must be one of: ${NOTIFICATION_PRIORITIES.join(", ")}`
      );
    }

    const { userId, ...rest } = options;

    if (userId) {
      return this.findByUser(userId, {
        ...rest,
        filter: { priority, ...rest.filter },
      });
    }

    const filter = { priority, isDeleted: false, ...rest.filter };
    return this.findMany(filter, { sort: { createdAt: -1 }, ...rest });
  }

  /* ---------------------------------------------------------------------- */
  /* Mutations                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Mark a single notification as read.
   *
   * @param {import("mongoose").Types.ObjectId|string} notificationId
   *   Notification id.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction
   *   session.
   * @returns {Promise<object|null>} The updated notification, or `null` if not
   *   found.
   * @throws {RepositoryValidationError} If `notificationId` is missing.
   */
  async markAsRead(notificationId, options = {}) {
    if (!notificationId) {
      throw new RepositoryValidationError(
        "NotificationRepository.markAsRead: `notificationId` is required"
      );
    }

    return this.update(notificationId, { isRead: true }, options);
  }

  /**
   * Mark all unread notifications for a user as read.
   *
   * Uses `updateMany` under the hood so the operation is a single atomic write.
   *
   * @param {import("mongoose").Types.ObjectId|string} userId Recipient user id.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction
   *   session.
   * @returns {Promise<{acknowledged: boolean, modifiedCount: number}>} Outcome
   *   summary with the number of notifications flipped.
   * @throws {RepositoryValidationError} If `userId` is missing.
   */
  async markAllAsRead(userId, options = {}) {
    if (!userId) {
      throw new RepositoryValidationError(
        "NotificationRepository.markAllAsRead: `userId` is required"
      );
    }

    const { session } = options;

    const result = await this.model
      .updateMany(
        { recipient: userId, isRead: false, isDeleted: false },
        { $set: { isRead: true } },
        { session }
      )
      .exec();

    return { acknowledged: result.acknowledged, modifiedCount: result.modifiedCount };
  }

  /**
   * Mark multiple specific notifications as read by their ids.
   *
   * Only notifications belonging to the given user are updated (ownership guard).
   *
   * @param {import("mongoose").Types.ObjectId|string} userId Owner of the
   *   notifications (ownership check).
   * @param {Array<import("mongoose").Types.ObjectId|string>} notificationIds
   *   Notification ids to mark as read.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction
   *   session.
   * @returns {Promise<{acknowledged: boolean, modifiedCount: number}>} Outcome
   *   summary.
   * @throws {RepositoryValidationError} If `userId` or `notificationIds` is
   *   missing/empty.
   */
  async markManyAsRead(userId, notificationIds, options = {}) {
    if (!userId) {
      throw new RepositoryValidationError(
        "NotificationRepository.markManyAsRead: `userId` is required"
      );
    }

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      throw new RepositoryValidationError(
        "NotificationRepository.markManyAsRead: `notificationIds` must be a non-empty array"
      );
    }

    const { session } = options;

    const result = await this.model
      .updateMany(
        {
          _id: { $in: notificationIds },
          recipient: userId,
          isRead: false,
          isDeleted: false,
        },
        { $set: { isRead: true } },
        { session }
      )
      .exec();

    return { acknowledged: result.acknowledged, modifiedCount: result.modifiedCount };
  }

  /* ---------------------------------------------------------------------- */
  /* Cleanup / bulk operations                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Permanently delete notifications older than a given date.
   *
   * This is a hard delete (not soft) and is intended for TTL-style cleanup of
   * stale notifications. Note: the Notification schema does not declare a
   * MongoDB TTL index, so cleanup is performed manually via this method or
   * an external scheduler.
   *
   * @param {Date|string} olderThan Cutoff date — notifications with
   *   `createdAt` before this date are deleted.
   * @param {object} [options={}]
   * @param {object} [options.filter] Extra filter criteria merged in (e.g.
   *   `{ recipient: someUserId }` to scope the cleanup).
   * @param {import("mongoose").ClientSession} [options.session] Transaction
   *   session.
   * @returns {Promise<{acknowledged: boolean, deletedCount: number}>} Outcome
   *   summary.
   * @throws {RepositoryValidationError} If `olderThan` is missing.
   */
  async deleteOlderThan(olderThan, options = {}) {
    if (!olderThan) {
      throw new RepositoryValidationError(
        "NotificationRepository.deleteOlderThan: `olderThan` date is required"
      );
    }

    const { filter: extraFilter, session } = options;
    const cutoff = new Date(olderThan);

    if (Number.isNaN(cutoff.getTime())) {
      throw new RepositoryValidationError(
        "NotificationRepository.deleteOlderThan: `olderThan` must be a valid date"
      );
    }

    const filter = {
      createdAt: { $lt: cutoff },
      ...extraFilter,
    };

    const result = await this.model.deleteMany(filter, { session }).exec();

    return { acknowledged: result.acknowledged, deletedCount: result.deletedCount };
  }

  /**
   * Soft-delete notifications older than a given date.
   *
   * Flags `isDeleted: true` instead of removing documents, which is appropriate
   * when the model supports soft deletes and you want a recoverable archival
   * strategy.
   *
   * @param {Date|string} olderThan Cutoff date.
   * @param {object} [options={}]
   * @param {object} [options.filter] Extra filter criteria merged in.
   * @param {import("mongoose").ClientSession} [options.session] Transaction
   *   session.
   * @returns {Promise<{acknowledged: boolean, modifiedCount: number}>} Outcome
   *   summary.
   * @throws {RepositoryValidationError} If `olderThan` is missing.
   */
  async softDeleteOlderThan(olderThan, options = {}) {
    if (!olderThan) {
      throw new RepositoryValidationError(
        "NotificationRepository.softDeleteOlderThan: `olderThan` date is required"
      );
    }

    const { filter: extraFilter, session } = options;
    const cutoff = new Date(olderThan);

    if (Number.isNaN(cutoff.getTime())) {
      throw new RepositoryValidationError(
        "NotificationRepository.softDeleteOlderThan: `olderThan` must be a valid date"
      );
    }

    const filter = {
      createdAt: { $lt: cutoff },
      isDeleted: false,
      ...extraFilter,
    };

    const result = await this.model
      .updateMany(filter, { $set: { isDeleted: true } }, { session })
      .exec();

    return { acknowledged: result.acknowledged, modifiedCount: result.modifiedCount };
  }
}

/**
 * Default shared instance bound to the real `Notification` model, mirroring
 * the ergonomics the other `/mongo` exports aim for.
 * @type {NotificationRepository}
 */
const notificationRepository = new NotificationRepository();

export default notificationRepository;
