import certificateService from "../services/certificate.service.js";
import mongoose from "mongoose";
import logger from "../config/logger.js";
import { recordAudit } from "../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";

export const generateCertificateController = async (req, res) => {
  try {
    const courseId = req.params?.id || req.body?.courseId || req.body?.course_id;
    const userId = req.user._id;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "courseId is required",
      });
    }

    const certificate = await certificateService.generateCertificate({ userId, courseId });
    const verification = certificateService.formatVerificationResponse(certificate);
    res.status(201).json({
      success: true,
      ...verification,
      data: certificate,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const getCertificateByIdController = async (req, res) => {
  try {
    const certificate = await certificateService.getCertificateById(req.params.id);
    const verification = certificateService.formatVerificationResponse(certificate);
    res.status(200).json({
      success: true,
      ...verification,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      valid: false,
      message: error.message,
    });
  }
};

export const getUserCertificatesController = async (req, res) => {
  try {
    const requestedUserId = req.params.userId;
    if (requestedUserId && !mongoose.Types.ObjectId.isValid(requestedUserId)) {
      return res.status(404).json({ success: false, message: "Certificates not found" });
    }
    const userId = requestedUserId || req.user._id;
    const isAdmin = req.user.role === "admin";
    if (requestedUserId && requestedUserId !== req.user._id.toString() && !isAdmin) {
      return res.status(403).json({ success: false, message: "You can only view your own certificates" });
    }
    const certificates = await certificateService.getUserCertificates(userId);
    res.status(200).json({
      success: true,
      count: certificates.length,
      data: certificates,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Turn a certificate identifier into a filename component that cannot escape
 * the download directory or inject header content.
 */
function safeCertificateFilename(certificateId) {
  const cleaned = String(certificateId || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 64);
  return `${cleaned || "certificate"}.pdf`;
}

export const downloadCertificateController = async (req, res) => {
  const targetId = req.params?.id;
  const requester = req.user?._id ?? null;

  let certificate;
  try {
    certificate = await certificateService.getCertificateForDownload(targetId);
  } catch (error) {
    // Never surface driver/validator text: it tells an attacker how the lookup
    // ran and whether the identifier was well formed (#701).
    logger.error(`Certificate download lookup failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Could not prepare the certificate download",
    });
  }

  if (!certificate) {
    recordAudit({
      action: AUDIT_ACTIONS.CERTIFICATE_DOWNLOAD_DENIED,
      actor: requester,
      req,
      targetType: "Certificate",
      targetId: String(targetId),
      status: "failure",
      metadata: { certificateId: String(targetId), reason: "not_found" },
    });
    return res.status(404).json({
      success: false,
      message: "Certificate not found",
    });
  }

  const ownerId = certificate.user?._id?.toString() || certificate.user?.toString();
  const requesterId = requester?.toString();

  if (ownerId !== requesterId && req.user?.role !== "admin") {
    recordAudit({
      action: AUDIT_ACTIONS.CERTIFICATE_DOWNLOAD_DENIED,
      actor: requester,
      req,
      targetType: "Certificate",
      targetId: certificate.certificateId,
      status: "failure",
      metadata: { certificateId: certificate.certificateId, reason: "not_owner" },
    });
    return res.status(403).json({
      success: false,
      message: "You do not have access to this certificate",
    });
  }

  let pdfBuffer;
  try {
    pdfBuffer = await certificateService.generatePDFBuffer(certificate);
  } catch (error) {
    logger.error(`Certificate PDF generation failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Could not prepare the certificate download",
    });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeCertificateFilename(certificate.certificateId)}"`
  );
  res.setHeader("Content-Length", pdfBuffer.length);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "private, no-store");

  recordAudit({
    action: AUDIT_ACTIONS.CERTIFICATE_DOWNLOAD,
    actor: requester,
    req,
    targetType: "Certificate",
    targetId: certificate.certificateId,
    status: "success",
    metadata: { certificateId: certificate.certificateId, reason: "owner_request" },
  });

  return res.send(pdfBuffer);
};
