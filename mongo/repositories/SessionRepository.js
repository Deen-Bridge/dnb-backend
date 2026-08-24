/**
 * @module mongo/repositories/SessionRepository
 * @description Repository for Session model database operations. Provides
 * methods for managing user sessions, token validation, and cleanup of
 * expired sessions with TTL index recommendations.
 */

import BaseRepository from "../base/BaseRepository.js";
import Session from "../../src/models/Session.js";
import crypto from "crypto";

/**
 * Repository for Session model operations.
 *
 * Extends BaseRepository with session-specific methods for:
 * - Finding sessions by token, user, or device
 * - Token validation and session verification
 * - Session cleanup and revocation
 * - Security features like rotation detection
 *
 * TTL Index Recommendation:
 * The Session model already has a TTL index on `expiresAt` with
 * `expireAfterSeconds: 0`. MongoDB automatically removes expired
 * sessions. For additional cleanup of revoked sessions, consider
 * running periodic cleanup jobs.
 *
 * @example
 * const sessionRepo = new SessionRepository();
 * const session = await sessionRepo.findByToken(refreshTokenHash);
 * const active = await sessionRepo.findActiveByUser(userId);
 * await sessionRepo.removeExpired();
 */
export default class SessionRepository extends BaseRepository {
  constructor() {
    super(Session);
  }

  /* -------------------------------------------------------------------------- */
  /* Session lookup methods                                                     */
  /* -------------------------------------------------------------------------- */

  /**
   * Find a session by its refresh token hash.
   *
   * @param {string} tokenHash - SHA-256 hash of the refresh token.
   * @param {object} [options]
   * @param {string|object} [options.select] - Projection.
   * @param {(Array|object|string)} [options.populate] - Paths to populate.
   * @param {boolean} [options.lean=false] - Return plain JS object.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|object|null>} The session or null.
   */
  async findByToken(tokenHash, options = {}) {
    return this.findOne({ refreshTokenHash: tokenHash }, options);
  }

  /**
   * Find a session by token and validate it's still active.
   * Returns null if session is expired or revoked.
   *
   * @param {string} tokenHash - SHA-256 hash of the refresh token.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Valid session or null.
   */
  async findValidByToken(tokenHash, options = {}) {
    return this.findOne(
      {
        refreshTokenHash: tokenHash,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { populate: { path: "user", select: "name email role isActive" }, ...options }
    );
  }

  /**
   * Find all active sessions for a specific user.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - The user's ID.
   * @param {object} [options]
   * @param {string|object} [options.select] - Projection.
   * @param {boolean} [options.lean=false] - Return plain JS objects.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<Array<import("mongoose").Document|object>>} Active sessions.
   */
  async findActiveByUser(userId, options = {}) {
    return this.findMany(
      {
        user: userId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
      {
        sort: { lastUsedAt: -1 },
        select: "device lastUsedAt createdAt expiresAt is2FAVerified",
        ...options,
      }
    );
  }

  /**
   * Find all sessions (including revoked/expired) for a user.
   * Useful for security audit and session history.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - The user's ID.
   * @param {object} [options] - Pagination options.
   * @returns {Promise<{data: Array, total: number, page: number, limit: number, totalPages: number, hasNextPage: boolean, hasPrevPage: boolean}>}
   */
  async findAllByUser(userId, options = {}) {
    return this.paginate({ user: userId }, {
      sortBy: "createdAt",
      order: "desc",
      ...options,
    });
  }

  /**
   * Find sessions by token family (for rotation tracking).
   *
   * @param {string} family - The token family UUID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<Array<import("mongoose").Document>>} Sessions in family.
   */
  async findByFamily(family, options = {}) {
    return this.findMany(
      { family },
      { sort: { createdAt: -1 }, ...options }
    );
  }

  /* -------------------------------------------------------------------------- */
  /* Session validation                                                         */
  /* -------------------------------------------------------------------------- */

  /**
   * Validate a session and update last used timestamp.
   *
   * @param {string} tokenHash - SHA-256 hash of the refresh token.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{valid: boolean, session: import("mongoose").Document|null, reason?: string}>}
   */
  async validateAndTouch(tokenHash, options = {}) {
    const session = await this.findByToken(tokenHash, options);

    if (!session) {
      return { valid: false, session: null, reason: "SESSION_NOT_FOUND" };
    }

    if (session.revokedAt) {
      return { valid: false, session, reason: "SESSION_REVOKED" };
    }

    if (session.expiresAt < new Date()) {
      return { valid: false, session, reason: "SESSION_EXPIRED" };
    }

    // Update last used timestamp
    session.lastUsedAt = new Date();
    await session.save({ session: options.session ?? null });

    return { valid: true, session };
  }

  /**
   * Check if a token has been reused after rotation (security alert).
   * This detects potential token theft.
   *
   * @param {string} tokenHash - SHA-256 hash of the refresh token.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{reused: boolean, session: import("mongoose").Document|null}>}
   */
  async detectTokenReuse(tokenHash, options = {}) {
    const session = await this.findByToken(tokenHash, options);

    if (!session) {
      return { reused: false, session: null };
    }

    // If session has been replaced, this token was reused after rotation
    if (session.replacedBy) {
      return { reused: true, session };
    }

    return { reused: false, session };
  }

  /* -------------------------------------------------------------------------- */
  /* Session lifecycle                                                          */
  /* -------------------------------------------------------------------------- */

  /**
   * Create a new session for a user.
   *
   * @param {object} data - Session data.
   * @param {string|import("mongoose").Types.ObjectId} data.user - User ID.
   * @param {string} data.refreshToken - Raw refresh token (will be hashed).
   * @param {string} data.family - Token family UUID.
   * @param {object} [data.device] - Device info.
   * @param {string} [data.device.userAgent] - User agent string.
   * @param {string} [data.device.ip] - IP address.
   * @param {string} [data.device.label] - Device label.
   * @param {Date} data.expiresAt - Session expiration date.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document>} Created session.
   */
  async createSession(data, options = {}) {
    const tokenHash = this._hashToken(data.refreshToken);
    return this.create(
      {
        user: data.user,
        refreshTokenHash: tokenHash,
        family: data.family,
        device: data.device,
        expiresAt: data.expiresAt,
      },
      { session: options.session }
    );
  }

  /**
   * Rotate a session's refresh token.
   * Revokes the old session and creates a new one in the same family.
   *
   * @param {string} oldTokenHash - Hash of the current refresh token.
   * @param {string} newRefreshToken - New raw refresh token.
   * @param {Date} newExpiresAt - New expiration date.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{oldSession: import("mongoose").Document, newSession: import("mongoose").Document}|null>}
   */
  async rotateToken(oldTokenHash, newRefreshToken, newExpiresAt, options = {}) {
    const oldSession = await this.findByToken(oldTokenHash, options);
    if (!oldSession || oldSession.revokedAt) {
      return null;
    }

    const newTokenHash = this._hashToken(newRefreshToken);

    // Create new session in same family
    const newSession = await this.create(
      {
        user: oldSession.user,
        refreshTokenHash: newTokenHash,
        family: oldSession.family,
        device: oldSession.device,
        expiresAt: newExpiresAt,
        is2FAVerified: oldSession.is2FAVerified,
      },
      { session: options.session }
    );

    // Revoke old session and link to new
    oldSession.revokedAt = new Date();
    oldSession.replacedBy = newSession._id;
    await oldSession.save({ session: options.session ?? null });

    return { oldSession, newSession };
  }

  /**
   * Revoke a specific session.
   *
   * @param {string|import("mongoose").Types.ObjectId} sessionId - Session ID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Revoked session.
   */
  async revoke(sessionId, options = {}) {
    return this.update(sessionId, { revokedAt: new Date() }, options);
  }

  /**
   * Revoke a session by its token hash.
   *
   * @param {string} tokenHash - SHA-256 hash of the refresh token.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Revoked session.
   */
  async revokeByToken(tokenHash, options = {}) {
    return this.update(
      { refreshTokenHash: tokenHash },
      { revokedAt: new Date() },
      options
    );
  }

  /**
   * Revoke all sessions for a user (logout everywhere).
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - User ID.
   * @param {object} [options]
   * @param {string|import("mongoose").Types.ObjectId} [options.exceptSessionId] - Session to keep active.
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{modifiedCount: number}>} Result with count of revoked sessions.
   */
  async revokeAllByUser(userId, options = {}) {
    const { exceptSessionId, session } = options;
    const filter = {
      user: userId,
      revokedAt: null,
    };

    if (exceptSessionId) {
      filter._id = { $ne: exceptSessionId };
    }

    const result = await this.model.updateMany(
      filter,
      { $set: { revokedAt: new Date() } },
      { session: session ?? null }
    );

    this.logger.info(
      { userId, exceptSessionId, modifiedCount: result.modifiedCount },
      "Revoked user sessions"
    );

    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Revoke all sessions in a token family (security breach response).
   *
   * @param {string} family - Token family UUID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{modifiedCount: number}>} Result with count of revoked sessions.
   */
  async revokeFamily(family, options = {}) {
    const result = await this.model.updateMany(
      { family, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { session: options.session ?? null }
    );

    this.logger.warn(
      { family, modifiedCount: result.modifiedCount },
      "Revoked entire token family"
    );

    return { modifiedCount: result.modifiedCount };
  }

  /**
   * Mark a session as 2FA verified.
   *
   * @param {string|import("mongoose").Types.ObjectId} sessionId - Session ID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<import("mongoose").Document|null>} Updated session.
   */
  async mark2FAVerified(sessionId, options = {}) {
    return this.update(sessionId, { is2FAVerified: true }, options);
  }

  /* -------------------------------------------------------------------------- */
  /* Cleanup operations                                                         */
  /* -------------------------------------------------------------------------- */

  /**
   * Remove expired sessions that MongoDB TTL hasn't cleaned yet.
   * This is a supplementary cleanup - the TTL index handles most cases.
   *
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{deletedCount: number}>} Result with count of deleted sessions.
   */
  async removeExpired(options = {}) {
    const result = await this.model.deleteMany(
      { expiresAt: { $lt: new Date() } },
      { session: options.session ?? null }
    );

    if (result.deletedCount > 0) {
      this.logger.info(
        { deletedCount: result.deletedCount },
        "Cleaned up expired sessions"
      );
    }

    return { deletedCount: result.deletedCount };
  }

  /**
   * Clean up old revoked sessions (older than retention period).
   *
   * @param {number} [retentionDays=30] - Days to retain revoked sessions.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{deletedCount: number}>} Result with count of deleted sessions.
   */
  async cleanupRevoked(retentionDays = 30, options = {}) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.model.deleteMany(
      { revokedAt: { $lt: cutoff } },
      { session: options.session ?? null }
    );

    if (result.deletedCount > 0) {
      this.logger.info(
        { deletedCount: result.deletedCount, retentionDays },
        "Cleaned up old revoked sessions"
      );
    }

    return { deletedCount: result.deletedCount };
  }

  /* -------------------------------------------------------------------------- */
  /* Statistics                                                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * Get session statistics for a user.
   *
   * @param {string|import("mongoose").Types.ObjectId} userId - User ID.
   * @param {object} [options]
   * @param {import("mongoose").ClientSession} [options.session] - Transaction session.
   * @returns {Promise<{active: number, total: number, revoked: number}>}
   */
  async getUserStats(userId, options = {}) {
    const now = new Date();
    const [active, total, revoked] = await Promise.all([
      this.count(
        { user: userId, revokedAt: null, expiresAt: { $gt: now } },
        { session: options.session }
      ),
      this.count({ user: userId }, { session: options.session }),
      this.count({ user: userId, revokedAt: { $ne: null } }, { session: options.session }),
    ]);

    return { active, total, revoked };
  }

  /* -------------------------------------------------------------------------- */
  /* Internal helpers                                                           */
  /* -------------------------------------------------------------------------- */

  /**
   * Hash a refresh token using SHA-256.
   *
   * @private
   * @param {string} token - Raw refresh token.
   * @returns {string} SHA-256 hash of the token.
   */
  _hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}
