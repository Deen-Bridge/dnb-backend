import PDFDocument from "pdfkit";

export function generateCertificatePDF(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        layout: "landscape",
        size: "A4",
        margin: 40,
      });

      const buffers = [];
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (err) => reject(err));

      const width = doc.page.width;
      const height = doc.page.height;
      const contentWidth = width - 80;

      // Outer Border (Dark navy blue)
      doc
        .lineWidth(6)
        .strokeColor("#1E3A8A")
        .rect(20, 20, width - 40, height - 40)
        .stroke();

      // Inner Decorative Border (Gold/amber accent)
      doc
        .lineWidth(2)
        .strokeColor("#D97706")
        .rect(30, 30, width - 60, height - 60)
        .stroke();

      // Header Brand
      doc
        .fillColor("#1E3A8A")
        .fontSize(22)
        .text("DEENBRIDGE ACADEMY", 40, 75, { width: contentWidth, align: "center" });

      // Title
      doc
        .fillColor("#111827")
        .fontSize(32)
        .text("CERTIFICATE OF COMPLETION", 40, 120, { width: contentWidth, align: "center" });

      // Subtitle
      doc
        .fillColor("#4B5563")
        .fontSize(16)
        .text("PROUDLY PRESENTED TO", 40, 175, { width: contentWidth, align: "center" });

      // Learner Name
      doc
        .fillColor("#1E3A8A")
        .fontSize(28)
        .text((data.learnerName || "Learner").toUpperCase(), 40, 210, { width: contentWidth, align: "center" });

      // Description text
      doc
        .fillColor("#374151")
        .fontSize(15)
        .text("for successfully mastering and completing all modules of the course", 40, 260, {
          width: contentWidth,
          align: "center",
        });

      // Course Title
      doc
        .fillColor("#D97706")
        .fontSize(24)
        .text(`"${data.courseTitle || "Course"}"`, 40, 295, { width: contentWidth, align: "center" });

      // Completion Date
      const formattedDate = new Date(data.completionDate || Date.now()).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      doc
        .fillColor("#4B5563")
        .fontSize(14)
        .text(`Awarded on ${formattedDate}`, 40, 350, { width: contentWidth, align: "center" });

      // Signatures
      const sigY = 420;

      // Instructor Signature Line
      doc
        .strokeColor("#9CA3AF")
        .lineWidth(1)
        .moveTo(150, sigY)
        .lineTo(330, sigY)
        .stroke();

      doc
        .fillColor("#111827")
        .fontSize(13)
        .text(data.instructorName || "DeenBridge Instructor", 150, sigY + 8, { width: 180, align: "center" });

      doc
        .fillColor("#6B7280")
        .fontSize(11)
        .text("Course Educator", 150, sigY + 24, { width: 180, align: "center" });

      // Organization Signature Line
      doc
        .strokeColor("#9CA3AF")
        .lineWidth(1)
        .moveTo(width - 330, sigY)
        .lineTo(width - 150, sigY)
        .stroke();

      doc
        .fillColor("#111827")
        .fontSize(13)
        .text(data.instructorSignature || "DeenBridge Verification", width - 330, sigY + 8, {
          width: 180,
          align: "center",
        });

      doc
        .fillColor("#6B7280")
        .fontSize(11)
        .text("Authorized Issuer", width - 330, sigY + 24, { width: 180, align: "center" });

      // Footer - Certificate ID
      doc
        .fillColor("#9CA3AF")
        .fontSize(10)
        .text(`Certificate ID: ${data.certificateId}`, 40, height - 60, { width: contentWidth, align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
