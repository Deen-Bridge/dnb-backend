import cloudinary from "../utils/cloudinary.js";
import { catchAsync, APIError } from "../middlewares/errorHandler.js";
import EducatorVerification, {
  VERIFICATION_STATUS,
} from "../models/EducatorVerification.js";
import User from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { recordAudit } from "../services/audit/auditService.js";

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

const serializeDocuments = (docs, includeSignedUrl = false) =>
  docs.map((d) => {
    const obj = {
      type: d.type,
      originalFileName: d.originalFileName,
      uploadedAt: d.uploadedAt,
    };
    if (includeSignedUrl) {
      obj.signedUrl = buildSignedUrl(d.cloudinaryPublicId);
    }
    return obj;
  });

export const getMyApplication = catchAsync(async (req, res) => {
  const applicantId = req.user._id;

  const verification = await EducatorVerification.findOne({
    applicant: applicantId,
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!verification) {
    return res.status(200).json({
      success: true,
      application: null,
    });
  }

  res.status(200).json({
    success: true,
    application: {
      ...verification,
      documents: serializeDocuments(verification.documents, true),
    },
  });
});

export const getDocumentSignedUrl = catchAsync(async (req, res) => {
  const { documentIndex } = req.params;
  const applicantId = req.user._id;
  const idx = parseInt(documentIndex, 10);

  if (isNaN(idx) || idx < 0) {
    throw new APIError("Invalid document index", 400);
  }

  const verification = await EducatorVerification.findOne({
    applicant: applicantId,
  }).sort({ createdAt: -1 });

  if (!verification) {
    throw new APIError("No verification application found", 404);
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

export const submitApplication = catchAsync(async (req, res) => {
  const applicantId = req.user._id;
  const { documents, personalStatement } = req.body || {};

  if (!Array.isArray(documents) || documents.length === 0) {
    throw new APIError(
      "At least one credential document is required to submit",
      400
    );
  }

  for (const d of documents) {
    if (!d.type || !d.cloudinaryPublicId || !d.originalFileName) {
      throw new APIError(
        "Each document must include type, cloudinaryPublicId, and originalFileName",
        400
      );
    }
  }

  let verification = await EducatorVerification.findOne({
    applicant: applicantId,
    status: { $in: [VERIFICATION_STATUS.DRAFT, VERIFICATION_STATUS.REJECTED] },
  });

  let isResubmit = false;
  let previousStatus = null;

  if (verification) {
    if (verification.status === VERIFICATION_STATUS.REJECTED) {
      isResubmit = true;
      previousStatus = verification.status;
      if (!verification.canTransitionTo(VERIFICATION_STATUS.PENDING)) {
        throw new APIError("Cannot resubmit this application", 409);
      }
      verification.status = VERIFICATION_STATUS.PENDING;
      verification.reviewedBy = null;
      verification.reviewNotes = null;
      verification.reviewedAt = null;
    } else {
      previousStatus = verification.status;
      if (!verification.canTransitionTo(VERIFICATION_STATUS.PENDING)) {
        throw new APIError("Cannot submit application from current state", 409);
      }
      verification.status = VERIFICATION_STATUS.PENDING;
    }
    verification.documents = documents;
    verification.personalStatement = personalStatement || null;
    verification.submittedAt = new Date();
  } else {
    const existingPendingOrApproved = await EducatorVerification.findOne({
      applicant: applicantId,
      status: {
        $in: [VERIFICATION_STATUS.PENDING, VERIFICATION_STATUS.APPROVED],
      },
    });
    if (existingPendingOrApproved) {
      throw new APIError(
        "An application is already pending or approved; cannot create a new one",
        409
      );
    }

    verification = new EducatorVerification({
      applicant: applicantId,
      status: VERIFICATION_STATUS.PENDING,
      documents,
      personalStatement: personalStatement || null,
      submittedAt: new Date(),
    });
    previousStatus = VERIFICATION_STATUS.DRAFT;
  }

  await verification.save();

  const auditAction = isResubmit
    ? AUDIT_ACTIONS.EDUCATOR_VERIFY_RESUBMIT
    : AUDIT_ACTIONS.EDUCATOR_VERIFY_SUBMIT;

  recordAudit({
    action: auditAction,
    actor: applicantId,
    req,
    targetType: "EducatorVerification",
    targetId: verification._id.toString(),
    status: "success",
    metadata: {
      verificationId: verification._id.toString(),
      previousStatus,
      newStatus: VERIFICATION_STATUS.PENDING,
      documentCount: documents.length,
    },
  });

  res.status(201).json({
    success: true,
    message: isResubmit
      ? "Application resubmitted for review"
      : "Application submitted for review",
    application: {
      _id: verification._id,
      status: verification.status,
      submittedAt: verification.submittedAt,
      documents: serializeDocuments(verification.documents, false),
    },
  });
});

export const generateUploadSignature = catchAsync(async (req, res) => {
  const timestamp = Math.round(new Date().getTime() / 1000);
  const config = cloudinary.config();

  if (!config.api_secret) {
    throw new APIError("Upload signing unavailable at this time", 503);
  }

  const folder = "educator-verification";
  const signature = cloudinary.utils.api_sign_request(
    {
      timestamp,
      folder,
      type: "authenticated",
    },
    config.api_secret
  );

  res.status(200).json({
    success: true,
    message: "Signature generated successfully",
    data: {
      timestamp,
      signature,
      cloudName: config.cloud_name,
      apiKey: config.api_key,
      folder,
      uploadType: "authenticated",
    },
  });
});
