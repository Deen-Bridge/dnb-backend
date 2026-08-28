import crypto from "crypto";
import Certificate from "../models/certificate.model.js";
import CourseProgress from "../models/CourseProgress.js";
import Course from "../models/Course.js";
import User from "../models/User.js";
import { generateCertificatePDF } from "../templates/certificate.template.js";

export class CertificateService {
  /**
   * Generates a unique certificate ID.
   */
  generateCertificateId() {
    const randomHex = crypto.randomBytes(4).toString("hex");
    return `cert_${randomHex}`;
  }

  computeCertificateHash(certificateId, userId, courseId, completionDate) {
    const raw = `${certificateId}:${userId}:${courseId}:${new Date(completionDate).toISOString()}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  /**
   * Issue / generate certificate upon course completion.
   */
  async generateCertificate({ userId, courseId }) {
    const existing = await Certificate.findOne({ user: userId, course: courseId })
      .populate("user", "name email avatar")
      .populate("course", "title category thumbnail");
    if (existing) {
      return existing;
    }

    const progress = await CourseProgress.findOne({ user: userId, course: courseId });
    if (!progress || (progress.percentComplete < 100 && !progress.completedAt)) {
      throw new Error("Course has not been completed yet");
    }

    const [user, course] = await Promise.all([
      User.findById(userId),
      Course.findById(courseId).populate("createdBy", "name"),
    ]);

    if (!user) throw new Error("User not found");
    if (!course) throw new Error("Course not found");

    const certificateId = this.generateCertificateId();
    const certificateUrl = `/api/certificates/${certificateId}/download`;
    const verificationUrl = `/api/certificates/${certificateId}`;
    const completionDate = progress.completedAt || new Date();
    const certificateHash = this.computeCertificateHash(
      certificateId,
      userId,
      courseId,
      completionDate
    );
    const stellarTx = crypto.createHash("sha256").update(`stellar:memo:${certificateHash}`).digest("hex");

    const certificate = await Certificate.create({
      certificateId,
      user: userId,
      course: courseId,
      learnerName: user.name,
      courseTitle: course.title,
      completionDate,
      instructorName: course.createdBy?.name || "DeenBridge Instructor",
      instructorSignature: "DeenBridge Verification",
      certificateUrl,
      verificationUrl,
      certificateHash,
      stellarTx,
    });

    return certificate;
  }

  async getCertificateById(idOrCertificateId) {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrCertificateId);
    const filter = isObjectId
      ? { $or: [{ _id: idOrCertificateId }, { certificateId: idOrCertificateId }] }
      : { certificateId: idOrCertificateId };

    const certificate = await Certificate.findOne(filter)
      .populate("user", "name email avatar")
      .populate({
        path: "course",
        select: "title category thumbnail createdBy",
        populate: { path: "createdBy", select: "name" },
      });

    if (!certificate) {
      throw new Error("Certificate not found");
    }

    return certificate;
  }

  formatVerificationResponse(certificate) {
    const completedAtStr = certificate.completionDate
      ? new Date(certificate.completionDate).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

    return {
      valid: true,
      certificate: {
        id: certificate.certificateId,
        student: certificate.learnerName || certificate.user?.name || "Student",
        course: certificate.courseTitle || certificate.course?.title || "Course",
        educator: certificate.instructorName || certificate.course?.createdBy?.name || "DeenBridge Instructor",
        completed_at: completedAtStr,
        stellar_tx: certificate.stellarTx || certificate.certificateHash,
      },
    };
  }

  async getUserCertificates(userId) {
    return await Certificate.find({ user: userId })
      .populate("course", "title category thumbnail rating")
      .sort({ createdAt: -1 });
  }

  async generatePDFBuffer(certificate) {
    return await generateCertificatePDF({
      learnerName: certificate.learnerName,
      courseTitle: certificate.courseTitle,
      completionDate: certificate.completionDate,
      certificateId: certificate.certificateId,
      instructorName: certificate.instructorName,
      instructorSignature: certificate.instructorSignature,
      verificationUrl: certificate.verificationUrl,
      certificateHash: certificate.certificateHash,
      stellarTx: certificate.stellarTx,
    });
  }
}

export default new CertificateService();
