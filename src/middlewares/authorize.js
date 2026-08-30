// middlewares/authorize.js
//
// Centralized resource-ownership authorization layer.
//
// These guards run after `protect` (which sets req.user) and enforce that the
// authenticated user either owns the target resource or is an admin before a
// mutating handler runs. Ownership denials are written to the audit log
// (fire-and-forget) and surfaced as a 403 via the global error handler.
import { APIError, catchAsync } from "./errorHandler.js";
import { recordAudit } from "../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";

/**
 * Guard that enforces ownership of a top-level resource (Book, Course, Space).
 *
 * Loads the document by id, allows owners and admins, and denies everyone else
 * with a 403 (auditing the denial). On success the loaded doc is attached as
 * `req.resource` so the handler can reuse it.
 *
 * @param {object} opts
 * @param {import("mongoose").Model} opts.model        - Mongoose model to load from
 * @param {string}                   opts.ownerField   - Field holding the owner ObjectId
 * @param {string}                   opts.resourceType - Human-readable type (e.g. "Book")
 * @param {string}                   [opts.idParam]    - req.params key for the id
 */
export const authorizeOwnership = ({ model, ownerField, resourceType, idParam = "id" }) =>
  catchAsync(async (req, _res, next) => {
    const doc = await model.findById(req.params[idParam]);
    if (!doc) {
      return next(new APIError(`${resourceType} not found`, 404));
    }

    const isAdmin = req.user?.role === "admin";
    const isOwner = doc[ownerField]?.toString() === req.user._id.toString();

    if (!isAdmin && !isOwner) {
      recordAudit({
        action: AUDIT_ACTIONS.AUTHZ_OWNERSHIP_DENIED,
        actor: req.user._id,
        req,
        targetType: resourceType,
        targetId: String(doc._id),
        status: "failure",
        metadata: { reason: `not owner of ${resourceType}`, role: req.user.role },
      });
      return next(
        new APIError(`You are not authorized to modify this ${resourceType.toLowerCase()}`, 403)
      );
    }

    req.resource = doc;
    next();
  });

/**
 * Guard that enforces ownership of a review subdocument living on a parent
 * item (Book or Course). Supports two shapes the review controllers accept:
 *   - id-scoped:   /:id/reviews/:reviewId  -> owner-check the named review
 *   - self-scoped: /:id/reviews            -> operate on the caller's own review
 *
 * On success the parent doc is attached as `req.parentResource` and the target
 * review as `req.review`.
 *
 * @param {object} opts
 * @param {import("mongoose").Model} opts.model          - Parent model (Book/Course)
 * @param {string}                   [opts.resourceType] - Type label for audit/errors
 * @param {string}                   [opts.idParam]      - req.params key for the parent id
 * @param {string}                   [opts.reviewParam]  - req.params key for the review id
 */
export const authorizeReviewOwnership = ({
  model,
  resourceType = "Review",
  idParam = "id",
  reviewParam = "reviewId",
}) =>
  catchAsync(async (req, _res, next) => {
    const parent = await model.findById(req.params[idParam]);
    if (!parent) {
      return next(new APIError(`${resourceType} not found`, 404));
    }

    const reviewId = req.params[reviewParam];
    let review;

    if (reviewId) {
      review = parent.reviews.id(reviewId);
      if (!review) {
        return next(new APIError("Review not found", 404));
      }

      const isAdmin = req.user?.role === "admin";
      const isOwner = review.user?.toString() === req.user._id.toString();

      if (!isAdmin && !isOwner) {
        recordAudit({
          action: AUDIT_ACTIONS.AUTHZ_OWNERSHIP_DENIED,
          actor: req.user._id,
          req,
          targetType: resourceType,
          targetId: String(review._id),
          status: "failure",
          metadata: { reason: `not owner of ${resourceType}`, role: req.user.role },
        });
        return next(new APIError("You are not authorized to modify this review", 403));
      }
    } else {
      // Self-scoped: operate on the caller's own review (owner by construction).
      review = parent.reviews.find(
        (r) => r.user?.toString() === req.user._id.toString()
      );
      if (!review) {
        return next(new APIError("Review not found", 404));
      }
    }

    req.parentResource = parent;
    req.review = review;
    next();
  });

export default { authorizeOwnership, authorizeReviewOwnership };
