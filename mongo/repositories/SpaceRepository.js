/**
 * @module mongo/repositories/SpaceRepository
 * Data-access layer for the {@link Space} model (#175).
 * -------------------------------------------------------------------------
 * `SpaceRepository` centralizes every Space-specific persistence query so
 * route handlers and services stop talking to the Mongoose model directly.
 *
 * Conventions:
 *   - Repositories never touch `res`/express - they return data or throw.
 *   - Every exported method carries complete JSDoc.
 *
 * Index recommendations (for optimal query performance):
 *   - { host: 1, status: 1 }           - findByOwner with status filtering
 *   - { enrolledUsers: 1, status: 1 }  - findByMember queries
 *   - { price: 1, status: 1 }          - public/free space queries
 *   - { eventDate: 1 }                 - upcoming/past space queries
 *   - { title: "text", description: "text", category: "text" } - text search
 *
 * @example
 * import SpaceRepository from "../mongo/repositories/SpaceRepository.js";
 *
 * const spaces = await SpaceRepository.findByOwner(userId, { status: "live" });
 * const publicSpaces = await SpaceRepository.findPublic({ limit: 20 });
 */

import Space from "../../src/models/Space.js";

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
 * Repository exposing Space-specific query helpers on top of the Mongoose
 * `Space` model.
 */
export class SpaceRepository {
  /**
   * @param {import("mongoose").Model} [model=Space] The Mongoose model this
   *   repository operates on.
   */
  constructor(model = Space) {
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
   * Escape user-supplied text for safe use inside a `RegExp`.
   *
   * @private
   * @param {string} value Raw input.
   * @returns {string} Regex-safe string.
   */
  _escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Fetch a single space by its identifier.
   *
   * @param {import("mongoose").Types.ObjectId|string} id Space id.
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object|null>} The space, or `null` if not found.
   * @throws {Error} If `id` is missing.
   */
  async findById(id, options = {}) {
    if (!id) throw new Error("SpaceRepository.findById: `id` is required");
    return this._applyOptions(this.model.findById(id), options).exec();
  }

  /**
   * Find all spaces hosted (owned) by a given user.
   *
   * @param {import("mongoose").Types.ObjectId|string} ownerId The host's User id.
   * @param {QueryOptions & { status?: string }} [options={}] Query options.
   *   `status` filters by space status ("live", "upcoming", "ended").
   * @returns {Promise<Object[]>} Matching spaces (newest first by default).
   * @throws {Error} If `ownerId` is missing.
   */
  async findByOwner(ownerId, options = {}) {
    if (!ownerId) {
      throw new Error("SpaceRepository.findByOwner: `ownerId` is required");
    }
    const { status, ...queryOptions } = options;
    const filter = { host: ownerId };
    if (status) filter.status = status;

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { createdAt: -1 }, ...queryOptions }).exec();
  }

  /**
   * Find all spaces where a user is enrolled as a member.
   *
   * @param {import("mongoose").Types.ObjectId|string} memberId The member's User id.
   * @param {QueryOptions & { status?: string }} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching spaces.
   * @throws {Error} If `memberId` is missing.
   */
  async findByMember(memberId, options = {}) {
    if (!memberId) {
      throw new Error("SpaceRepository.findByMember: `memberId` is required");
    }
    const { status, ...queryOptions } = options;
    const filter = { enrolledUsers: memberId };
    if (status) filter.status = status;

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { eventDate: 1 }, ...queryOptions }).exec();
  }

  /**
   * Find public spaces (free spaces available to anyone).
   *
   * Public spaces are defined as spaces with price = 0 and upcoming or live status.
   *
   * @param {QueryOptions & { status?: string }} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching public spaces.
   */
  async findPublic(options = {}) {
    const { status, ...queryOptions } = options;
    const filter = { price: 0 };
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $in: ["live", "upcoming"] };
    }

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { eventDate: 1 }, ...queryOptions }).exec();
  }

  /**
   * Find upcoming spaces (not yet started).
   *
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object[]>} Upcoming spaces sorted by event date.
   */
  async findUpcoming(options = {}) {
    const filter = {
      status: "upcoming",
      eventDate: { $gte: new Date() },
    };
    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { eventDate: 1 }, ...options }).exec();
  }

  /**
   * Find live spaces (currently in session).
   *
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object[]>} Live spaces.
   */
  async findLive(options = {}) {
    const filter = { status: "live" };
    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { eventDate: -1 }, ...options }).exec();
  }

  /**
   * Find spaces by category.
   *
   * @param {string} category Category name (case-insensitive match).
   * @param {QueryOptions & { status?: string }} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching spaces.
   * @throws {Error} If `category` is missing.
   */
  async findByCategory(category, options = {}) {
    if (!category) {
      throw new Error("SpaceRepository.findByCategory: `category` is required");
    }
    const { status, ...queryOptions } = options;
    const filter = {
      category: new RegExp(`^${this._escapeRegex(category)}$`, "i"),
    };
    if (status) filter.status = status;

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { eventDate: 1 }, ...queryOptions }).exec();
  }

  /**
   * Search spaces by free text.
   *
   * Uses the schema's compound text index (`title`, `description`, `category`)
   * and sorts by relevance.
   *
   * @param {string} term The search term.
   * @param {QueryOptions & { status?: string }} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching spaces.
   * @throws {Error} If `term` is empty.
   */
  async search(term, options = {}) {
    if (!term || !String(term).trim()) {
      throw new Error("SpaceRepository.search: `term` is required");
    }
    const { status, ...queryOptions } = options;
    const trimmed = String(term).trim();

    const filter = { $text: { $search: trimmed } };
    if (status) filter.status = status;

    const query = this.model.find(filter, { score: { $meta: "textScore" } });
    return this._applyOptions(
      query,
      { sort: { score: { $meta: "textScore" } }, ...queryOptions }
    ).exec();
  }

  /**
   * Advanced filtering with multiple criteria.
   *
   * @param {Object} [criteria={}]
   * @param {import("mongoose").Types.ObjectId|string} [criteria.host] Host user id.
   * @param {string} [criteria.category] Category (case-insensitive).
   * @param {string|string[]} [criteria.status] Status or statuses to include.
   * @param {number} [criteria.minPrice] Minimum price.
   * @param {number} [criteria.maxPrice] Maximum price (0 for free only).
   * @param {Date} [criteria.fromDate] Events on or after this date.
   * @param {Date} [criteria.toDate] Events on or before this date.
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching spaces.
   */
  async filter(criteria = {}, options = {}) {
    const { host, category, status, minPrice, maxPrice, fromDate, toDate } = criteria;
    const filter = {};

    if (host) filter.host = host;

    if (category) {
      filter.category = new RegExp(`^${this._escapeRegex(category)}$`, "i");
    }

    if (status) {
      filter.status = Array.isArray(status) ? { $in: status } : status;
    }

    if (minPrice != null || maxPrice != null) {
      filter.price = {};
      if (minPrice != null) filter.price.$gte = minPrice;
      if (maxPrice != null) filter.price.$lte = maxPrice;
    }

    if (fromDate || toDate) {
      filter.eventDate = {};
      if (fromDate) filter.eventDate.$gte = fromDate;
      if (toDate) filter.eventDate.$lte = toDate;
    }

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { eventDate: 1 }, ...options }).exec();
  }

  // -------------------------------------------------------------------------
  // Member management queries
  // -------------------------------------------------------------------------

  /**
   * Get the list of enrolled members for a space.
   *
   * @param {import("mongoose").Types.ObjectId|string} spaceId Space id.
   * @param {QueryOptions} [options={}] Query options for populating members.
   * @returns {Promise<Object[]>} Enrolled user objects (when populated) or ids.
   * @throws {Error} If `spaceId` is missing.
   */
  async getMembers(spaceId, options = {}) {
    if (!spaceId) {
      throw new Error("SpaceRepository.getMembers: `spaceId` is required");
    }
    const space = await this.model
      .findById(spaceId)
      .populate({
        path: "enrolledUsers",
        select: options.select || "name email avatar",
      })
      .lean()
      .exec();

    return space?.enrolledUsers || [];
  }

  /**
   * Get the waitlist for a space.
   *
   * @param {import("mongoose").Types.ObjectId|string} spaceId Space id.
   * @param {QueryOptions} [options={}] Query options for populating members.
   * @returns {Promise<Object[]>} Waitlist user objects (when populated) or ids.
   * @throws {Error} If `spaceId` is missing.
   */
  async getWaitlist(spaceId, options = {}) {
    if (!spaceId) {
      throw new Error("SpaceRepository.getWaitlist: `spaceId` is required");
    }
    const space = await this.model
      .findById(spaceId)
      .populate({
        path: "waitList",
        select: options.select || "name email avatar",
      })
      .lean()
      .exec();

    return space?.waitList || [];
  }

  /**
   * Check if a user is enrolled in a space.
   *
   * @param {import("mongoose").Types.ObjectId|string} spaceId Space id.
   * @param {import("mongoose").Types.ObjectId|string} userId User id.
   * @returns {Promise<boolean>} True if the user is enrolled.
   */
  async isMember(spaceId, userId) {
    if (!spaceId || !userId) {
      throw new Error("SpaceRepository.isMember: `spaceId` and `userId` are required");
    }
    const count = await this.model
      .countDocuments({ _id: spaceId, enrolledUsers: userId })
      .exec();
    return count > 0;
  }

  /**
   * Check if a user is on the waitlist for a space.
   *
   * @param {import("mongoose").Types.ObjectId|string} spaceId Space id.
   * @param {import("mongoose").Types.ObjectId|string} userId User id.
   * @returns {Promise<boolean>} True if the user is on the waitlist.
   */
  async isOnWaitlist(spaceId, userId) {
    if (!spaceId || !userId) {
      throw new Error("SpaceRepository.isOnWaitlist: `spaceId` and `userId` are required");
    }
    const count = await this.model
      .countDocuments({ _id: spaceId, waitList: userId })
      .exec();
    return count > 0;
  }

  /**
   * Add a user to the enrolled members list.
   *
   * @param {import("mongoose").Types.ObjectId|string} spaceId Space id.
   * @param {import("mongoose").Types.ObjectId|string} userId User id.
   * @returns {Promise<Object|null>} Updated space or null if not found.
   */
  async addMember(spaceId, userId) {
    return this.model
      .findByIdAndUpdate(
        spaceId,
        { $addToSet: { enrolledUsers: userId } },
        { new: true }
      )
      .exec();
  }

  /**
   * Remove a user from the enrolled members list.
   *
   * @param {import("mongoose").Types.ObjectId|string} spaceId Space id.
   * @param {import("mongoose").Types.ObjectId|string} userId User id.
   * @returns {Promise<Object|null>} Updated space or null if not found.
   */
  async removeMember(spaceId, userId) {
    return this.model
      .findByIdAndUpdate(
        spaceId,
        { $pull: { enrolledUsers: userId } },
        { new: true }
      )
      .exec();
  }

  /**
   * Add a user to the waitlist.
   *
   * @param {import("mongoose").Types.ObjectId|string} spaceId Space id.
   * @param {import("mongoose").Types.ObjectId|string} userId User id.
   * @returns {Promise<Object|null>} Updated space or null if not found.
   */
  async addToWaitlist(spaceId, userId) {
    return this.model
      .findByIdAndUpdate(
        spaceId,
        { $addToSet: { waitList: userId } },
        { new: true }
      )
      .exec();
  }

  /**
   * Remove a user from the waitlist.
   *
   * @param {import("mongoose").Types.ObjectId|string} spaceId Space id.
   * @param {import("mongoose").Types.ObjectId|string} userId User id.
   * @returns {Promise<Object|null>} Updated space or null if not found.
   */
  async removeFromWaitlist(spaceId, userId) {
    return this.model
      .findByIdAndUpdate(
        spaceId,
        { $pull: { waitList: userId } },
        { new: true }
      )
      .exec();
  }

  /**
   * Get member count for a space.
   *
   * @param {import("mongoose").Types.ObjectId|string} spaceId Space id.
   * @returns {Promise<number>} Number of enrolled members.
   */
  async getMemberCount(spaceId) {
    const space = await this.model
      .findById(spaceId)
      .select("enrolledUsers")
      .lean()
      .exec();
    return space?.enrolledUsers?.length || 0;
  }

  /**
   * Count spaces matching an arbitrary filter.
   *
   * @param {Object} [filter={}] A Mongoose filter object.
   * @returns {Promise<number>} The matching document count.
   */
  async count(filter = {}) {
    return this.model.countDocuments(filter).exec();
  }
}

/**
 * Default shared instance bound to the real `Space` model.
 * @type {SpaceRepository}
 */
const spaceRepository = new SpaceRepository();

export default spaceRepository;
