import express from "express";
import { ReferralService } from "../../services/referralService";
import authMiddleware from "../../middlewares/authMiddleware";

const router = express.Router();

router.get("/code", authMiddleware, async (req: any, res: any) => {
  try {
    const code = await ReferralService.getOrCreateReferralCode(req.user._id);
    res.json({ success: true, referralCode: code });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/track", authMiddleware, async (req: any, res: any) => {
  try {
    const { referralCode } = req.body;
    if (!referralCode) {
      return res.status(400).json({ success: false, message: "Referral code is required" });
    }
    const referral = await ReferralService.trackReferral(req.user._id, referralCode);
    res.json({ success: true, referral });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get("/analytics", authMiddleware, async (req: any, res: any) => {
  try {
    const analytics = await ReferralService.getReferralAnalytics(req.user._id);
    res.json({ success: true, analytics });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
