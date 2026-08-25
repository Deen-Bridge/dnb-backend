import crypto from "crypto";
import Certificate from "../models/certificate.model.js";
import CourseProgress from "../models/CourseProgress.js";
import Course from "../models/Course.js";
import User from "../models/User.js";
import { generateCertificatePDF } from "../templates/certificate.template.js";

export class CertificateService {
  generateCertificateId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const randomHex = crypto.randomBytes(3).toString("hex").toUpperCase();
    return `CERT-${timestamp}-${randomHex}`;
  }

  async generateCertificate({ userId, courseId }) {
    const existing = await Certificate.findOne({ user: userId, course: courseId });
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

    const certificate = await Certificate.create({
      certificateId,
      user: userId,
      course: courseId,
      learnerName: user.name,
      courseTitle: course.title,
      completionDate: progress.completedAt || new Date(),
      instructorName: course.createdBy?.name || "DeenBridge Instructor",
      instructorSignature: "DeenBridge Verification",
      certificateUrl,
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
      .populate("course", "title category thumbnail");

    if (!certificate) {
      throw new Error("Certificate not found");
    }

    return certificate;
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
    });
  }
}

export default new CertificateService();
