import express, { Request, Response } from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import { Experiment, ExperimentAssignment, ExperimentConversion } from "../../models/experiment.js";
import { assignVariant, trackConversion, calculateSignificance } from "../../services/analytics/ab-testing-service.js";
import logger from "../../config/logger.js";

const router = express.Router();

/**
 * @route   GET /api/analytics/experiments
 * @desc    List all experiments
 * @access  Admin
 */
router.get("/", protect, authorizeRoles("admin"), async (_req: Request, res: Response) => {
  try {
    const experiments = await Experiment.find().sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      data: experiments,
    });
  } catch (error: any) {
    logger.error("Error listing experiments:", error);
    return res.status(500).json({ success: false, message: "Failed to list experiments", error: error.message });
  }
});

/**
 * @route   POST /api/analytics/experiments
 * @desc    Create a new experiment
 * @access  Admin
 */
router.post("/", protect, authorizeRoles("admin"), async (req: Request, res: Response) => {
  try {
    const { key, name, description, variants, targeting, startDate, endDate, status } = req.body;
    if (!key || !name || !variants || !Array.isArray(variants) || variants.length === 0) {
      return res.status(400).json({ success: false, message: "Key, name, and at least one variant are required" });
    }

    const experiment = await Experiment.create({
      key,
      name,
      description,
      variants,
      targeting,
      startDate,
      endDate,
      status: status || "draft",
    });

    return res.status(201).json({
      success: true,
      message: "Experiment created successfully",
      data: experiment,
    });
  } catch (error: any) {
    logger.error("Error creating experiment:", error);
    return res.status(500).json({ success: false, message: "Failed to create experiment", error: error.message });
  }
});

/**
 * @route   GET /api/analytics/experiments/:key
 * @desc    Get experiment by key
 * @access  Admin
 */
router.get("/:key", protect, authorizeRoles("admin"), async (req: Request, res: Response) => {
  try {
    const experiment = await Experiment.findOne({ key: req.params.key });
    if (!experiment) {
      return res.status(404).json({ success: false, message: "Experiment not found" });
    }
    return res.status(200).json({ success: true, data: experiment });
  } catch (error: any) {
    logger.error("Error fetching experiment:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch experiment", error: error.message });
  }
});

/**
 * @route   PATCH /api/analytics/experiments/:key
 * @desc    Update experiment status or config
 * @access  Admin
 */
router.patch("/:key", protect, authorizeRoles("admin"), async (req: Request, res: Response) => {
  try {
    const { name, description, variants, targeting, startDate, endDate, status } = req.body;
    const experiment = await Experiment.findOneAndUpdate(
      { key: req.params.key },
      { $set: { name, description, variants, targeting, startDate, endDate, status } },
      { new: true, runValidators: true }
    );

    if (!experiment) {
      return res.status(404).json({ success: false, message: "Experiment not found" });
    }

    return res.status(200).json({ success: true, message: "Experiment updated successfully", data: experiment });
  } catch (error: any) {
    logger.error("Error updating experiment:", error);
    return res.status(500).json({ success: false, message: "Failed to update experiment", error: error.message });
  }
});

/**
 * @route   POST /api/analytics/experiments/:key/assign
 * @desc    Assign user/session to variant
 * @access  Public / Private
 */
router.post("/:key/assign", async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { sessionId, userId } = req.body;

    const identifier = sessionId || req.headers["x-session-id"] || (req as any).ip;
    if (!identifier) {
      return res.status(400).json({ success: false, message: "Session ID or identifier required" });
    }

    const variant = await assignVariant(key, String(identifier), userId);
    return res.status(200).json({
      success: true,
      data: { experimentKey: key, variantName: variant },
    });
  } catch (error: any) {
    logger.error("Error assigning variant:", error);
    return res.status(500).json({ success: false, message: "Failed to assign variant", error: error.message });
  }
});

/**
 * @route   POST /api/analytics/experiments/:key/convert
 * @desc    Track conversion metric for variant
 * @access  Public / Private
 */
router.post("/:key/convert", async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { sessionId, userId, metricName = "conversion", value = 1, metadata } = req.body;

    const identifier = sessionId || req.headers["x-session-id"] || (req as any).ip;
    if (!identifier) {
      return res.status(400).json({ success: false, message: "Session ID or identifier required" });
    }

    const tracked = await trackConversion({
      experimentKey: key,
      metricName,
      identifier: String(identifier),
      userId,
      value,
      metadata,
    });

    if (!tracked) {
      return res.status(400).json({ success: false, message: "No active assignment found for session/user" });
    }

    return res.status(200).json({ success: true, message: "Conversion tracked successfully" });
  } catch (error: any) {
    logger.error("Error tracking conversion:", error);
    return res.status(500).json({ success: false, message: "Failed to track conversion", error: error.message });
  }
});

/**
 * @route   GET /api/analytics/experiments/:key/results
 * @desc    Get experiment results and statistical significance
 * @access  Admin
 */
router.get("/:key/results", protect, authorizeRoles("admin"), async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { metricName = "conversion" } = req.query;

    const results = await calculateSignificance(key, String(metricName));
    return res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    logger.error("Error calculating significance:", error);
    return res.status(500).json({ success: false, message: "Failed to calculate results", error: error.message });
  }
});

export default router;
