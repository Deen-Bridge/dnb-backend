import cloudinary from "../../utils/cloudinary.js";
import mongoose from "mongoose";
import { catchAsync, APIError } from "../../middlewares/errorHandler.js";
import EducatorVerification, {
  VERIFICATION_STATUS,
} from "../../models/EducatorVerification.js";
import User from "../../models/User.js";
import { AUDIT_ACTIONS } from "../../models/AuditLog.js";
import { recordAudit } from "../../services/audit/auditService.js";

const SIGNED_URL_TTL_SECONDS = 600;

const buildSignedUrl = (publicId) => {
  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    return null;
  }
  try {
    return cloudinary.url(publicId, {
      sign_url: true,
      secure: true,
      expires_at: Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS,
    });
  } catch (_) {
    return null;
  }
};

const serializeDocumentsWithSignedUrls = (docs) =>
  docs.map((d) => ({
    type: d.type,
    originalFileName: d.originalFileName,
    uploadedAt: d.uploadedAt,
    signedUrl: buildSignedUrl(d.cloudinaryPublicId),
  }));

export const listApplications = catchAsync(async (req, res) => {
  const {
    status,
    page = "1",
    limit = "20",
  } = req.query;

  const filter = {};
  if (status) {
    const valid = Object.values(VERIFICATION_STATUS);
    if (!valid.includes(status)) {
      throw new APIError(`Invalid status. Must be one of: ${valid.join(", ")}`, 400);
    }
    filter.status = status;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [applications, total] = await Promise.all([
    EducatorVerification.find(filter)
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("applicant", "name email role verifiedEducator")
      .populate("reviewedBy", "name email")
      .lean(),
    EducatorVerification.countDocuments(filter),
  ]);

  const serialized = applications.map((a) => ({
    ...a,
    documents: serializeDocumentsWithSignedUrls(a.documents || []),
  }));

  res.status(200).json({
    success: true,
    applications: serialized,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  });
});

export const getApplicationById = catchAsync(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new APIError("Invalid application id", 400);
  }

  const application = await EducatorVerification.findById(id)
    .populate("applicant", "name email role verifiedEducator")
    .populate("reviewedBy", "name email")
    .lean();

  if (!application) {
    throw new APIError("Application not found", 404);
  }

  const serialized = {
    ...application,
    documents: serializeDocumentsWithSignedUrls(application.documents || []),
  };

  res.status(200).json({
    success: true,
    application: serialized,
  });
});

export const getAdminDocumentSignedUrl = catchAsync(async (req, res) => {
  const { id, documentIndex } = req.params;
  const idx = parseInt(documentIndex, 10);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new APIError("Invalid application id", 400);
  }
  if (isNaN(idx) || idx < 0) {
    throw new APIError("Invalid document index", 400);
  }

  const verification = await EducatorVerification.findById(id);
  if (!verification) {
    throw new APIError("Application not found", 404);
  }
  if (idx >= verification.documents.length) {
    throw new APIError("Document not found", 404);
  }

  const doc = verification.documents[idx];
  const signedUrl = buildSignedUrl(doc.cloudinaryPublicId);

  if (!signedUrl) {
    throw new APIError("Unable to generate signed URL at this time", 503);
  }

  res.status(200).json({
    success: true,
    data: {
      signedUrl,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    },
  });
});

const performReview = async (req, res, targetStatus, auditAction) => {
  const { id } = req.params;
  const { reviewNotes } = req.body || {};
  const reviewerId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new APIError("Invalid application id", 400);
  }

  const verification = await EducatorVerification.findById(id);
  if (!verification) {
    throw new APIError("Application not found", 404);
  }

  const previousStatus = verification.status;

  if (!verification.canTransitionTo(targetStatus)) {
    throw new APIError(
      `Cannot transition from '${previousStatus}' to '${targetStatus}'`,
      409
    );
  }

  const applicantId = verification.applicant;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    verification.status = targetStatus;
    verification.reviewedBy = reviewerId;
    verification.reviewNotes = reviewNotes || null;
    verification.reviewedAt = new Date();
    await verification.save({ session });

    if (targetStatus === VERIFICATION_STATUS.APPROVED) {
      await User.updateOne(
        { _id: applicantId },
        { $set: { verifiedEducator: true } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }

  recordAudit({
    action: auditAction,
    actor: reviewerId,
    req,
    targetType: "EducatorVerification",
    targetId: verification._id.toString(),
    status: "success",
    metadata: {
      verificationId: verification._id.toString(),
      previousStatus,
      newStatus: targetStatus,
      reviewedBy: reviewerId.toString(),
      reviewNotes: reviewNotes || null,
      educatorId: applicantId.toString(),
    },
  });

  res.status(200).json({
    success: true,
    message:
      targetStatus === VERIFICATION_STATUS.APPROVED
        ? "Application approved — educator now verified"
        : "Application rejected",
    application: {
      _id: verification._id,
      status: verification.status,
      reviewedBy: verification.reviewedBy,
      reviewNotes: verification.reviewNotes,
      reviewedAt: verification.reviewedAt,
    },
  });
};

export const approveApplication = catchAsync(async (req, res) => {
  return performReview(
    req,
    res,
    VERIFICATION_STATUS.APPROVED,
    AUDIT_ACTIONS.EDUCATOR_VERIFY_APPROVE
  );
});

export const rejectApplication = catchAsync(async (req, res) => {
  return performReview(
    req,
    res,
    VERIFICATION_STATUS.REJECTED,
    AUDIT_ACTIONS.EDUCATOR_VERIFY_REJECT
  );
});
