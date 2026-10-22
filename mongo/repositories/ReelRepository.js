/**
 * @module mongo/repositories/ReelRepository
 * Data-access layer for the {@link Reel} model.
 * -------------------------------------------------------------------------
 * `ReelRepository` extends `BaseRepository` to inherit generic CRUD,
 * offset/cursor pagination, and typed error handling, then adds
 * reel-specific query helpers: creator scoping, trending queries,
 * engagement tracking, and filtering/sorting options.
 *
 * Field notes (derived from the real Reel schema):
 *   - Creator: `createdBy` (ObjectId ref to User)
 *   - Engagement: `likes` (array of User refs), `loves` (array of User refs),
 *     `comments` (array of comment subdocs), `shareCount` (Number),
 *     `viewCount` (Number)
 *   - Space: The Reel schema does not currently have a `spaceId` field.
 *     `findBySpace` is implemented as a placeholder for future schema changes.
 *
 * @example
 * import ReelRepository from "../mongo/repositories/ReelRepository.js";
 *
 * const creatorReels = await ReelRepository.findByCreator(userId, { limit: 10 });
 * const trending = await ReelRepository.findTrending({ limit: 20 });
 * await ReelRepository.incrementViewCount(reelId);
 */

import BaseRepository, {
  RepositoryValidationError,
} from "../base/BaseRepository.js";
import Reel from "../../src/models/Reel.js";

/**
 * Repository exposing Reel-specific query helpers on top of
 * {@link BaseRepository}.
 *
 * Instances are cheap and stateless; a shared default instance is exported so
 * callers can `import ReelRepository from ".../ReelRepository.js"` and use it
 * immediately, while still allowing `new ReelRepository(model)` for tests that
 * need to inject a mock model.
 */
export class ReelRepository extends BaseRepository {
  /**
   * @param {import("mongoose").Model} [model=Reel] The Mongoose model
   *   this repository operates on. Defaults to the real `Reel` model;
   *   accepting it as a parameter keeps the class testable.
   */
  constructor(model = Reel) {
    super(model);
  }

  /* ---------------------------------------------------------------------- */
  /* Queries                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Fetch reels created by a specific user.
   *
   * @param {import("mongoose").Types.ObjectId|string} creatorId Creator user id.
   * @param {object} [options={}] Query options forwarded to
   *   {@link BaseRepository#paginate} or {@link BaseRepository#findMany}.
   * @param {boolean} [options.paginate=false] When `true`, returns offset-paginated
   *   results via {@link BaseRepository#paginate}. Otherwise returns a plain array.
   * @param {object} [options.filter] Additional filter criteria merged into the
   *   base `{ createdBy: creatorId }` query.
   * @returns {Promise<object[]|{data: object[], total: number, ...}>} Matching
   *   reels, newest first by default.
   * @throws {RepositoryValidationError} If `creatorId` is missing.
   */
  async findByCreator(creatorId, options = {}) {
    if (!creatorId) {
      throw new RepositoryValidationError(
        "ReelRepository.findByCreator: `creatorId` is required"
      );
    }

    const { paginate: usePaginate, filter: extraFilter, ...rest } = options;
    const filter = {
      createdBy: creatorId,
      ...extraFilter,
    };

    const defaults = { sort: { createdAt: -1 }, ...rest };

    if (usePaginate) {
      return this.paginate(filter, defaults);
    }

    return this.findMany(filter, defaults);
  }

  /**
   * Fetch reels belonging to a specific space.
   *
   * Note: The Reel schema does not currently have a `spaceId` field.
   * This method is implemented as a placeholder for future schema changes.
   * When a `spaceId` field is added to the Reel schema, this method will
   * work without modification.
   *
   * @param {import("mongoose").Types.ObjectId|string} spaceId Space id.
   * @param {object} [options={}] Query options (same shape as
   *   {@link ReelRepository#findByCreator}).
   * @returns {Promise<object[]|{data: object[], total: number, ...}>} Matching
   *   reels (currently returns empty array until schema is updated).
   * @throws {RepositoryValidationError} If `spaceId` is missing.
   */
  async findBySpace(spaceId, options = {}) {
    if (!spaceId) {
      throw new RepositoryValidationError(
        "ReelRepository.findBySpace: `spaceId` is required"
      );
    }

    const { paginate: usePaginate, filter: extraFilter, ...rest } = options;

    // Check if the model has a spaceId field
    if (!this.model.schema.path("spaceId")) {
      // Schema doesn't have spaceId yet - return empty results
      const defaults = { sort: { createdAt: -1 }, ...rest };
      if (usePaginate) {
        return {
          data: [],
          total: 0,
          page: 1,
          limit: defaults.limit || 20,
          totalPages: 0,
          offset: 0,
          hasNextPage: false,
          hasPrevPage: false,
        };
      }
      return [];
    }

    const filter = {
      spaceId: spaceId,
      ...extraFilter,
    };

    const defaults = { sort: { createdAt: -1 }, ...rest };

    if (usePaginate) {
      return this.paginate(filter, defaults);
    }

    return this.findMany(filter, defaults);
  }

  /**
   * Fetch trending reels ranked by engagement metrics.
   *
   * Engagement is calculated as: viewCount + (likes.length * 2) +
   * (loves.length * 3) + (comments.length * 4). Reels are sorted by
   * this engagement score in descending order.
   *
   * @param {object} [options={}] Query options.
   * @param {number} [options.limit=20] Maximum number of reels to return.
   * @param {number} [options.days=7] Number of days to look back for trending.
   * @param {object} [options.filter] Additional filter criteria.
   * @param {string|object} [options.select] Projection.
   * @param {(Array|object|string)} [options.populate] Paths to populate.
   * @param {boolean} [options.lean=false] Return plain objects.
   * @returns {Promise<object[]>} Trending reels ordered by engagement.
   */
  async findTrending(options = {}) {
    const {
      limit = 20,
      days = 7,
      filter: extraFilter,
      select,
      populate,
      lean = false,
      ...rest
    } = options;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const filter = {
      createdAt: { $gte: cutoffDate },
      ...extraFilter,
    };

    // Use aggregation to calculate engagement score and sort by it
    const pipeline = [
      { $match: filter },
      {
        $addFields: {
          engagementScore: {
            $add: [
              { $ifNull: ["$viewCount", 0] },
              { $multiply: [{ $size: { $ifNull: ["$likes", []] } }, 2] },
              { $multiply: [{ $size: { $ifNull: ["$loves", []] } }, 3] },
              { $multiply: [{ $size: { $ifNull: ["$comments", []] } }, 4] },
            ],
          },
        },
      },
      { $sort: { engagementScore: -1, createdAt: -1 } },
      { $limit: limit },
    ];

    if (select) {
      pipeline.push({ $project: typeof select === "string" ? { [select]: 1 } : select });
    }

    let result = await this.model.aggregate(pipeline).exec();

    if (lean) {
      result = result.map((doc) => ({ ...doc }));
    }

    if (populate) {
      result = await this.model.populate(result, populate);
    }

    return result;
  }

  /* ---------------------------------------------------------------------- */
  /* Engagement Tracking                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Atomically increment a reel's view count.
   *
   * @param {import("mongoose").Types.ObjectId|string} reelId Reel id.
   * @param {number} [amount=1] Amount to increment by.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The updated reel, or `null` if not found.
   * @throws {RepositoryValidationError} If `reelId` is missing or `amount` is not a number.
   */
  async incrementViewCount(reelId, amount = 1, options = {}) {
    if (!reelId) {
      throw new RepositoryValidationError(
        "ReelRepository.incrementViewCount: `reelId` is required"
      );
    }
    if (typeof amount !== "number" || Number.isNaN(amount)) {
      throw new RepositoryValidationError(
        "ReelRepository.incrementViewCount: `amount` must be a number"
      );
    }

    const { session } = options;

    return this.model
      .findByIdAndUpdate(
        reelId,
        { $inc: { viewCount: amount } },
        { new: true, session }
      )
      .exec();
  }

  /**
   * Add a user to a reel's likes array (if not already present) and
   * remove them from loves (toggle behavior).
   *
   * Uses `$addToSet` for atomic add and `$pull` for atomic remove,
   * ensuring race-safe operations.
   *
   * @param {import("mongoose").Types.ObjectId|string} reelId Reel id.
   * @param {import("mongoose").Types.ObjectId|string} userId User id to like.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The updated reel, or `null` if not found.
   * @throws {RepositoryValidationError} If `reelId` or `userId` is missing.
   */
  async addLike(reelId, userId, options = {}) {
    if (!reelId) {
      throw new RepositoryValidationError(
        "ReelRepository.addLike: `reelId` is required"
      );
    }
    if (!userId) {
      throw new RepositoryValidationError(
        "ReelRepository.addLike: `userId` is required"
      );
    }

    const { session } = options;

    return this.model
      .findByIdAndUpdate(
        reelId,
        {
          $addToSet: { likes: userId },
          $pull: { loves: userId },
        },
        { new: true, session }
      )
      .exec();
  }

  /**
   * Remove a user from a reel's likes array.
   *
   * @param {import("mongoose").Types.ObjectId|string} reelId Reel id.
   * @param {import("mongoose").Types.ObjectId|string} userId User id to remove.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The updated reel, or `null` if not found.
   * @throws {RepositoryValidationError} If `reelId` or `userId` is missing.
   */
  async removeLike(reelId, userId, options = {}) {
    if (!reelId) {
      throw new RepositoryValidationError(
        "ReelRepository.removeLike: `reelId` is required"
      );
    }
    if (!userId) {
      throw new RepositoryValidationError(
        "ReelRepository.removeLike: `userId` is required"
      );
    }

    const { session } = options;

    return this.model
      .findByIdAndUpdate(
        reelId,
        { $pull: { likes: userId } },
        { new: true, session }
      )
      .exec();
  }

  /**
   * Add a user to a reel's loves array (if not already present) and
   * remove them from likes (toggle behavior).
   *
   * @param {import("mongoose").Types.ObjectId|string} reelId Reel id.
   * @param {import("mongoose").Types.ObjectId|string} userId User id to love.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The updated reel, or `null` if not found.
   * @throws {RepositoryValidationError} If `reelId` or `userId` is missing.
   */
  async addLove(reelId, userId, options = {}) {
    if (!reelId) {
      throw new RepositoryValidationError(
        "ReelRepository.addLove: `reelId` is required"
      );
    }
    if (!userId) {
      throw new RepositoryValidationError(
        "ReelRepository.addLove: `userId` is required"
      );
    }

    const { session } = options;

    return this.model
      .findByIdAndUpdate(
        reelId,
        {
          $addToSet: { loves: userId },
          $pull: { likes: userId },
        },
        { new: true, session }
      )
      .exec();
  }

  /**
   * Remove a user from a reel's loves array.
   *
   * @param {import("mongoose").Types.ObjectId|string} reelId Reel id.
   * @param {import("mongoose").Types.ObjectId|string} userId User id to remove.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The updated reel, or `null` if not found.
   * @throws {RepositoryValidationError} If `reelId` or `userId` is missing.
   */
  async removeLove(reelId, userId, options = {}) {
    if (!reelId) {
      throw new RepositoryValidationError(
        "ReelRepository.removeLove: `reelId` is required"
      );
    }
    if (!userId) {
      throw new RepositoryValidationError(
        "ReelRepository.removeLove: `userId` is required"
      );
    }

    const { session } = options;

    return this.model
      .findByIdAndUpdate(
        reelId,
        { $pull: { loves: userId } },
        { new: true, session }
      )
      .exec();
  }

  /**
   * Add a comment to a reel.
   *
   * @param {import("mongoose").Types.ObjectId|string} reelId Reel id.
   * @param {object} comment Comment data (must include `user` and `text`).
   * @param {import("mongoose").Types.ObjectId|string} comment.user User id of commenter.
   * @param {string} comment.text Comment text.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The updated reel, or `null` if not found.
   * @throws {RepositoryValidationError} If required fields are missing.
   */
  async addComment(reelId, comment, options = {}) {
    if (!reelId) {
      throw new RepositoryValidationError(
        "ReelRepository.addComment: `reelId` is required"
      );
    }
    if (!comment || !comment.user || !comment.text) {
      throw new RepositoryValidationError(
        "ReelRepository.addComment: `comment.user` and `comment.text` are required"
      );
    }

    const { session } = options;

    const commentDoc = {
      user: comment.user,
      text: comment.text,
      createdAt: new Date(),
    };

    return this.model
      .findByIdAndUpdate(
        reelId,
        { $push: { comments: commentDoc } },
        { new: true, session }
      )
      .exec();
  }

  /**
   * Remove a comment from a reel.
   *
   * @param {import("mongoose").Types.ObjectId|string} reelId Reel id.
   * @param {import("mongoose").Types.ObjectId|string} commentId Comment id to remove.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The updated reel, or `null` if not found.
   * @throws {RepositoryValidationError} If `reelId` or `commentId` is missing.
   */
  async removeComment(reelId, commentId, options = {}) {
    if (!reelId) {
      throw new RepositoryValidationError(
        "ReelRepository.removeComment: `reelId` is required"
      );
    }
    if (!commentId) {
      throw new RepositoryValidationError(
        "ReelRepository.removeComment: `commentId` is required"
      );
    }

    const { session } = options;

    return this.model
      .findByIdAndUpdate(
        reelId,
        { $pull: { comments: { _id: commentId } } },
        { new: true, session }
      )
      .exec();
  }

  /**
   * Atomically increment a reel's share count.
   *
   * @param {import("mongoose").Types.ObjectId|string} reelId Reel id.
   * @param {number} [amount=1] Amount to increment by.
   * @param {object} [options={}]
   * @param {import("mongoose").ClientSession} [options.session] Transaction session.
   * @returns {Promise<object|null>} The updated reel, or `null` if not found.
   * @throws {RepositoryValidationError} If `reelId` is missing or `amount` is not a number.
   */
  async incrementShareCount(reelId, amount = 1, options = {}) {
    if (!reelId) {
      throw new RepositoryValidationError(
        "ReelRepository.incrementShareCount: `reelId` is required"
      );
    }
    if (typeof amount !== "number" || Number.isNaN(amount)) {
      throw new RepositoryValidationError(
        "ReelRepository.incrementShareCount: `amount` must be a number"
      );
    }

    const { session } = options;

    return this.model
      .findByIdAndUpdate(
        reelId,
        { $inc: { shareCount: amount } },
        { new: true, session }
      )
      .exec();
  }

  /* ---------------------------------------------------------------------- */
  /* Filtering and Sorting                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Flexible multi-criterion filter combining common Reel dimensions.
   *
   * Any omitted criterion is simply not applied.
   *
   * @param {object} [criteria={}]
   * @param {import("mongoose").Types.ObjectId|string} [criteria.creator] Creator user id.
   * @param {string} [criteria.category] Category string.
   * @param {string[]} [criteria.tags] Tag labels.
   * @param {string} [criteria.search] Free text search on description.
   * @param {number} [criteria.minViews] Minimum view count.
   * @param {number} [criteria.minLikes] Minimum like count.
   * @param {number} [criteria.minComments] Minimum comment count.
   * @param {object} [options={}] Query options.
   * @param {string} [options.sortBy="createdAt"] Field to sort by.
   * @param {("asc"|"desc")} [options.order="desc"] Sort direction.
   * @param {number} [options.limit] Maximum results.
   * @param {number} [options.page] Page number for pagination.
   * @param {boolean} [options.paginate=false] Use pagination.
   * @returns {Promise<object[]|{data: object[], total: number, ...}>} Matching reels.
   */
  async filter(criteria = {}, options = {}) {
    const {
      creator,
      category,
      tags,
      search,
      minViews,
      minLikes,
      minComments,
    } = criteria;

    const {
      sortBy = "createdAt",
      order = "desc",
      paginate: usePaginate,
      ...rest
    } = options;

    const filter = {};

    if (creator) filter.createdBy = creator;
    if (category) filter.category = category;

    if (tags != null) {
      const list = (Array.isArray(tags) ? tags : [tags]).filter(
        (t) => t != null && String(t).trim() !== ""
      );
      if (list.length > 0) {
        filter.tags = { $in: list };
      }
    }

    if (search) {
      filter.description = { $regex: search, $options: "i" };
    }

    // Note: minViews, minLikes, minComments require aggregation
    // For now, we'll do a basic find and filter in memory if needed
    // A production implementation would use aggregation pipeline
    if (minViews != null || minLikes != null || minComments != null) {
      // Use aggregation for complex filtering
      const pipeline = [{ $match: filter }];

      if (minViews != null) {
        pipeline.push({ $match: { viewCount: { $gte: minViews } } });
      }
      if (minLikes != null) {
        pipeline.push({
          $match: { $expr: { $gte: [{ $size: { $ifNull: ["$likes", []] } }, minLikes] } },
        });
      }
      if (minComments != null) {
        pipeline.push({
          $match: { $expr: { $gte: [{ $size: { $ifNull: ["$comments", []] } }, minComments] } },
        });
      }

      const direction = String(order).toLowerCase() === "asc" ? 1 : -1;
      pipeline.push({ $sort: { [sortBy]: direction } });

      if (rest.limit) pipeline.push({ $limit: rest.limit });

      return this.model.aggregate(pipeline).exec();
    }

    const direction = String(order).toLowerCase() === "asc" ? 1 : -1;
    const sort = { [sortBy]: direction };

    if (usePaginate) {
      return this.paginate(filter, { sort, ...rest });
    }

    return this.findMany(filter, { sort, ...rest });
  }
}

/**
 * Default shared instance bound to the real `Reel` model, mirroring
 * the ergonomics the other `/mongo` exports aim for.
 * @type {ReelRepository}
 */
const reelRepository = new ReelRepository();

export default reelRepository;
