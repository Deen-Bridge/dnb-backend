import Space from "../models/Space.js";
import logger from "../config/logger.js";
import {
  ensureMeetingMetadata,
  generateJitsiJwt,
  isJwtConfigured,
} from "../services/calls/jitsiTokenService.js";

export const createSpaceMeetingToken = async (req, res) => {
  try {
    const { spaceId } = req.body;

    if (!spaceId) {
      return res
        .status(400)
        .json({ success: false, message: "spaceId is required." });
    }

    const space = await Space.findById(spaceId).populate(
      "host",
      "name email avatar"
    );

    if (!space) {
      return res
        .status(404)
        .json({ success: false, message: "Space not found." });
    }

    ensureMeetingMetadata(space);

    const requiresJwt = isJwtConfigured();
    const isModerator = space.host?._id?.toString() === req.user._id.toString();
    const displayName = req.user?.name || req.user?.email || "Guest User";

    let token = null;

    if (requiresJwt) {
      token = generateJitsiJwt({
        roomName: space.meetingRoom,
        userId: req.user._id.toString(),
        displayName,
        email: req.user?.email,
        avatar: req.user?.avatar,
        isModerator,
      });
    }

    if (!space.meetingUrl || !space.meetingRoom?.length) {
      await space.save();
    }

    res.status(200).json({
      success: true,
      requiresJwt,
      token,
      isModerator,
      domain: process.env.JITSI_MEET_DOMAIN || "meet.jit.si",
      meetingRoom: space.meetingRoom,
      meetingUrl: space.meetingUrl,
    });
  } catch (error) {
    logger.error("Failed to create space meeting token:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Unable to create meeting token.",
    });
  }
};
