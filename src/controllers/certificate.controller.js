import certificateService from "../services/certificate.service.js";

export const generateCertificateController = async (req, res) => {
  try {
    const { courseId } = req.body;
    const userId = req.user._id;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "courseId is required",
      });
    }

    const certificate = await certificateService.generateCertificate({ userId, courseId });
    res.status(201).json({
      success: true,
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
    res.status(200).json({
      success: true,
      data: certificate,
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

export const getUserCertificatesController = async (req, res) => {
  try {
    const userId = req.params.userId || req.user._id;
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

export const downloadCertificateController = async (req, res) => {
  try {
    const certificate = await certificateService.getCertificateById(req.params.id);
    const pdfBuffer = await certificateService.generatePDFBuffer(certificate);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${certificate.certificateId}.pdf"`
    );
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};
