import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export async function generateCertificatePDF(data) {
  const qrBuffer = await QRCode.toBuffer(
    data.verificationUrl || `https://deenbridge.com/certificates/${data.certificateId}`,
    { width: 70, margin: 1 }
  );

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
        .text("DEENBRIDGE ACADEMY", 40, 60, { width: contentWidth, align: "center" });

      // Title
      doc
        .fillColor("#111827")
        .fontSize(30)
        .text("CERTIFICATE OF COMPLETION", 40, 100, { width: contentWidth, align: "center" });

      // Subtitle
      doc
        .fillColor("#4B5563")
        .fontSize(15)
        .text("PROUDLY PRESENTED TO", 40, 150, { width: contentWidth, align: "center" });

      // Learner Name
      doc
        .fillColor("#1E3A8A")
        .fontSize(26)
        .text((data.learnerName || "Learner").toUpperCase(), 40, 180, { width: contentWidth, align: "center" });

      // Description text
      doc
        .fillColor("#374151")
        .fontSize(14)
        .text("for successfully mastering and completing all modules of the course", 40, 225, {
          width: contentWidth,
          align: "center",
        });

      // Course Title
      doc
        .fillColor("#D97706")
        .fontSize(22)
        .text(`"${data.courseTitle || "Course"}"`, 40, 255, { width: contentWidth, align: "center" });

      // Completion Date
      const formattedDate = new Date(data.completionDate || Date.now()).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      doc
        .fillColor("#4B5563")
        .fontSize(13)
        .text(`Awarded on ${formattedDate}`, 40, 305, { width: contentWidth, align: "center" });

      // Draw QR Code
      const qrSize = 60;
      const qrX = width / 2 - qrSize / 2;
      const qrY = 330;
      doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
      doc
        .fillColor("#6B7280")
        .fontSize(8)
        .text("Scan to verify", 40, qrY + qrSize + 2, { width: contentWidth, align: "center" });

      // Signatures
      const sigY = 430;

      // Instructor Signature Line
      doc
        .strokeColor("#9CA3AF")
        .lineWidth(1)
        .moveTo(100, sigY)
        .lineTo(280, sigY)
        .stroke();

      doc
        .fillColor("#111827")
        .fontSize(12)
        .text(data.instructorName || "DeenBridge Instructor", 100, sigY + 6, { width: 180, align: "center" });

      doc
        .fillColor("#6B7280")
        .fontSize(10)
        .text("Course Educator", 100, sigY + 20, { width: 180, align: "center" });

      // Organization Signature Line
      doc
        .strokeColor("#9CA3AF")
        .lineWidth(1)
        .moveTo(width - 280, sigY)
        .lineTo(width - 100, sigY)
        .stroke();

      doc
        .fillColor("#111827")
        .fontSize(12)
        .text(data.instructorSignature || "DeenBridge Verification", width - 280, sigY + 6, {
          width: 180,
          align: "center",
        });

      doc
        .fillColor("#6B7280")
        .fontSize(10)
        .text("Authorized Issuer", width - 280, sigY + 20, { width: 180, align: "center" });

      // Footer - Certificate ID & On-chain Hash
      const hashInfo = data.stellarTx
        ? ` | Stellar TX: ${data.stellarTx.slice(0, 16)}...`
        : data.certificateHash
          ? ` | Hash: ${data.certificateHash.slice(0, 16)}...`
          : "";
      doc
        .fillColor("#9CA3AF")
        .fontSize(9)
        .text(`Certificate ID: ${data.certificateId}${hashInfo}`, 40, height - 40, { width: contentWidth, align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
