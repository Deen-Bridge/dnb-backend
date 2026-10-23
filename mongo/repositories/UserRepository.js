/**
 * @module mongo/repositories/UserRepository
 * @description Repository for User model database operations. Provides
 * methods for user authentication queries, profile lookups, and wallet
 * address searches.
 */

import BaseRepository from "../base/BaseRepository.js";
import User from "../../src/models/User.js";

/**
 * Repository for User model operations.
 *
 * Extends BaseRepository with user-specific methods for:
 * - Finding users by email, wallet address, or role
 * - Authentication-related queries
 * - Profile and follow system operations
 * - User search and discovery
 *
 * @example
 * const userRepo = new UserRepository();
 * const user = await userRepo.findByEmail("user@example.com");
 * const educators = await userRepo.findEducators({ page: 1, limit: 20 });
 */
export default class UserRepository extends BaseRepository {
  constructor() {
    super(User);
  }

  /* -------------------------------------------------------------------------- */
  /* User lookup methods                                                        */
  /* -------------------------------------------------------------------------- */

  /**
   * Find a user by email address.
   *
   * @param {string} email - User's email address.
   * @param {object} [options]
   * @param {string|object} [options.select] - Projection.
   * @param {boolean} [options.lean=false] - Return plain JS object.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|object|null>} The user or null.
   */
  async findByEmail(email, options = {}) {
    return this.findOne({ email: email.toLowerCase().trim() }, options);
  }

  /**
   * Find a user by Stellar wallet public key.
   *
   * @param {string} publicKey - Stellar public key (starts with 'G').
   * @param {object} [options]
   * @param {string|object} [options.select] - Projection.
   * @param {boolean} [options.lean=false] - Return plain JS object.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|object|null>} The user or null.
   */
  async findByWalletAddress(publicKey, options = {}) {
    return this.findOne({ "stellarWallet.publicKey": publicKey }, options);
  }

  /**
   * Find a user by password reset token hash.
   *
   * @param {string} tokenHash - SHA-256 hash of the reset token.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} The user or null.
   */
  async findByResetToken(tokenHash, options = {}) {
    return this.findOne(
      {
        resetTokenHash: tokenHash,
        resetTokenExpiry: { $gt: new Date() },
      },
      options
    );
  }

  /**
   * Check if an email is already registered.
   *
   * @param {string} email - Email to check.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<boolean>} True if email exists.
   */
  async emailExists(email, options = {}) {
    const count = await this.count(
      { email: email.toLowerCase().trim() },
      { limit: 1, session: options.session }
    );
    return count > 0;
  }

  /**
   * Check if a wallet is already connected to an account.
   *
   * @param {string} publicKey - Stellar public key.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<boolean>} True if wallet is connected.
   */
  async walletExists(publicKey, options = {}) {
    const count = await this.count(
      { "stellarWallet.publicKey": publicKey },
      { limit: 1, session: options.session }
    );
    return count > 0;
  }

  /* -------------------------------------------------------------------------- */
  /* Authentication queries                                                     */
  /* -------------------------------------------------------------------------- */

  /**
   * Find user for authentication (includes password field).
   *
   * @param {string} email - User's email address.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} User with password field.
   */
  async findForAuth(email, options = {}) {
    return this.model
      .findOne({ email: email.toLowerCase().trim() })
      .select("+password +twoFactor.secret +twoFactor.recoveryCodes")
      .session(options.session ?? null);
  }

  /**
   * Update last login timestamp.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - User ID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated user.
   */
  async updateLastLogin(userId, options = {}) {
    return this.update(
      userId,
      { lastLogin: new Date(), failedLoginAttempts: 0, lockUntil: null },
      options
    );
  }

  /**
   * Increment failed login attempts.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - User ID.
   * @param {object} [options]
   * @param {number} [options.lockThreshold=5] - Attempts before locking.
   * @param {number} [options.lockDurationMinutes=15] - Lock duration.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{user: import("mongoose").Document, locked: boolean}>}
   */
  async incrementFailedAttempts(userId, options = {}) {
    const { lockThreshold = 5, lockDurationMinutes = 15, session } = options;

    const user = await this.findById(userId, { session });
    if (!user) return { user: null, locked: false };

    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

    if (user.failedLoginAttempts >= lockThreshold) {
      user.lockUntil = new Date(Date.now() + lockDurationMinutes * 60 * 1000);
    }

    await user.save({ session: session ?? null });
    return { user, locked: !!user.lockUntil };
  }

  /**
   * Check if user account is locked.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - User ID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{locked: boolean, lockUntil: Date|null}>}
   */
  async isLocked(userId, options = {}) {
    const user = await this.findById(userId, {
      select: "lockUntil",
      lean: true,
      session: options.session,
    });

    if (!user || !user.lockUntil) {
      return { locked: false, lockUntil: null };
    }

    const locked = user.lockUntil > new Date();
    return { locked, lockUntil: locked ? user.lockUntil : null };
  }

  /**
   * Clear account lock.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - User ID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated user.
   */
  async clearLock(userId, options = {}) {
    return this.update(
      userId,
      { failedLoginAttempts: 0, lockUntil: null },
      options
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Role-based queries                                                         */
  /* -------------------------------------------------------------------------- */

  /**
   * Find all educators (mentors).
   *
   * @param {object} [options] - Pagination options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findEducators(options = {}) {
    return this.paginate({ role: "mentor", isActive: true }, {
      sortBy: "createdAt",
      order: "desc",
      select: "name email avatar bio country interests followers verifiedEducator",
      ...options,
    });
  }

  /**
   * Find verified educators.
   *
   * @param {object} [options] - Pagination options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findVerifiedEducators(options = {}) {
    return this.paginate(
      { role: "mentor", isActive: true, verifiedEducator: true },
      {
        sortBy: "createdAt",
        order: "desc",
        select: "name email avatar bio country interests followers",
        ...options,
      }
    );
  }

  /**
   * Find admins.
   *
   * @param {object} [options] - Query options.
   * @returns {Promise<Array<import("mongoose").Document>>} Admin users.
   */
  async findAdmins(options = {}) {
    return this.findMany(
      { role: "admin", isActive: true },
      { select: "name email", ...options }
    );
  }

  /**
   * Find users by role.
   *
   * @param {string|string[]} role - Role or array of roles.
   * @param {object} [options] - Pagination options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findByRole(role, options = {}) {
    const filter = Array.isArray(role)
      ? { role: { $in: role }, isActive: true }
      : { role, isActive: true };
    return this.paginate(filter, {
      sortBy: "createdAt",
      order: "desc",
      ...options,
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Follow system                                                              */
  /* -------------------------------------------------------------------------- */

  /**
   * Add a follower relationship.
   *
   * @param {string|import("mongoose").Types.ObjectId} followerId - User who is following.
   * @param {string|import("mongoose").Types.ObjectId} targetId - User being followed.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{success: boolean}>}
   */
  async follow(followerId, targetId, options = {}) {
    const { session } = options;

    await Promise.all([
      this.model.findByIdAndUpdate(
        followerId,
        { $addToSet: { following: targetId } },
        { session: session ?? null }
      ),
      this.model.findByIdAndUpdate(
        targetId,
        { $addToSet: { followers: followerId } },
        { session: session ?? null }
      ),
    ]);

    return { success: true };
  }

  /**
   * Remove a follower relationship.
   *
   * @param {string|import("mongoose").Types.ObjectId} followerId - User who is unfollowing.
   * @param {string|import("mongoose").Types.ObjectId} targetId - User being unfollowed.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{success: boolean}>}
   */
  async unfollow(followerId, targetId, options = {}) {
    const { session } = options;

    await Promise.all([
      this.model.findByIdAndUpdate(
        followerId,
        { $pull: { following: targetId } },
        { session: session ?? null }
      ),
      this.model.findByIdAndUpdate(
        targetId,
        { $pull: { followers: followerId } },
        { session: session ?? null }
      ),
    ]);

    return { success: true };
  }

  /**
   * Check if a user is following another user.
   *
   * @param {string|import("mongoose").Types.ObjectId} followerId - User who may be following.
   * @param {string|import("mongoose").Types.ObjectId} targetId - User who may be followed.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<boolean>}
   */
  async isFollowing(followerId, targetId, options = {}) {
    const count = await this.count(
      { _id: followerId, following: targetId },
      { limit: 1, session: options.session }
    );
    return count > 0;
  }

  /**
   * Get followers of a user.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - User ID.
   * @param {object} [options] - Pagination options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async getFollowers(userId, options = {}) {
    const user = await this.findById(userId, {
      select: "followers",
      lean: true,
    });
    if (!user || !user.followers?.length) {
      return { data: [], total: 0, page: 1, limit: 20, totalPages: 0, hasNextPage: false, hasPrevPage: false };
    }

    return this.paginate(
      { _id: { $in: user.followers } },
      {
        select: "name email avatar bio",
        ...options,
      }
    );
  }

  /**
   * Get users that a user is following.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - User ID.
   * @param {object} [options] - Pagination options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async getFollowing(userId, options = {}) {
    const user = await this.findById(userId, {
      select: "following",
      lean: true,
    });
    if (!user || !user.following?.length) {
      return { data: [], total: 0, page: 1, limit: 20, totalPages: 0, hasNextPage: false, hasPrevPage: false };
    }

    return this.paginate(
      { _id: { $in: user.following } },
      {
        select: "name email avatar bio",
        ...options,
      }
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Search and discovery                                                       */
  /* -------------------------------------------------------------------------- */

  /**
   * Search users by name, bio, or interests using text index.
   *
   * @param {string} query - Search query.
   * @param {object} [options] - Pagination options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async search(query, options = {}) {
    return this.paginate(
      {
        $text: { $search: query },
        isActive: true,
      },
      {
        select: "name email avatar bio country interests role",
        ...options,
      }
    );
  }

  /**
   * Find users by interests.
   *
   * @param {string|string[]} interests - Interest(s) to match.
   * @param {object} [options] - Pagination options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findByInterests(interests, options = {}) {
    const interestArray = Array.isArray(interests) ? interests : [interests];
    return this.paginate(
      {
        interests: { $in: interestArray },
        isActive: true,
      },
      {
        select: "name email avatar bio interests",
        ...options,
      }
    );
  }

  /**
   * Find users by country.
   *
   * @param {string} country - Country name.
   * @param {object} [options] - Pagination options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findByCountry(country, options = {}) {
    return this.paginate(
      { country, isActive: true },
      {
        select: "name email avatar bio",
        ...options,
      }
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Wallet operations                                                          */
  /* -------------------------------------------------------------------------- */

  /**
   * Connect a Stellar wallet to a user account.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - User ID.
   * @param {string} publicKey - Stellar public key.
   * @param {string} [network="testnet"] - Network (testnet/mainnet).
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated user.
   */
  async connectWallet(userId, publicKey, network = "testnet", options = {}) {
    return this.update(
      userId,
      {
        stellarWallet: {
          publicKey,
          connectedAt: new Date(),
          network,
        },
      },
      options
    );
  }

  /**
   * Disconnect wallet from user account.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - User ID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated user.
   */
  async disconnectWallet(userId, options = {}) {
    return this.update(
      userId,
      { stellarWallet: null },
      options
    );
  }

  /**
   * Find users with connected wallets.
   *
   * @param {object} [options] - Pagination options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findWithWallet(options = {}) {
    return this.paginate(
      { "stellarWallet.publicKey": { $exists: true, $ne: null } },
      {
        select: "name email stellarWallet",
        ...options,
      }
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Statistics                                                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * Get user statistics by role.
   *
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<object>} Statistics by role.
   */
  async getStatsByRole(options = {}) {
    const stats = await this.model.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: "$role",
          count: { $sum: 1 },
          verified: {
            $sum: { $cond: ["$isVerified", 1, 0] },
          },
          withWallet: {
            $sum: { $cond: [{ $ne: ["$stellarWallet.publicKey", null] }, 1, 0] },
          },
        },
      },
    ]).session(options.session ?? null);

    const result = {};
    for (const stat of stats) {
      result[stat._id] = {
        count: stat.count,
        verified: stat.verified,
        withWallet: stat.withWallet,
      };
    }
    return result;
  }
}
