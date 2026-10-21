import User from "../models/User";
import Referral from "../models/Referral";
import { generateReferralCode } from "../utils/referralCodeGenerator";

export class ReferralService {
  static async getOrCreateReferralCode(userId: string): Promise<string> {
    let user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Assuming we can store referralCode on User or generate/check if needed.
    // Since User.js doesn't have referralCode field natively in schema, let's check or assign, 
    // or we can add it or search Referral model. Wait, let's store it or generate unique code.
    // Let's check if User schema has referralCode or if we can query Referral.
    // Actually, let's attach/ensure referralCode on User document or generate one.
    if (!user.get("referralCode")) {
      let code;
      let exists = true;
      while (exists) {
        code = generateReferralCode();
        const existing = await User.findOne({ referralCode: code });
        if (!existing) {
          exists = false;
        }
      }
      user.set("referralCode", code);
      await user.save();
    }
    return user.get("referralCode");
  }

  static async trackReferral(refereeId: string, referralCode: string): Promise<any> {
    const referrerUser = await User.findOne({ referralCode: referralCode.toUpperCase() });
    if (!referrerUser) {
      throw new Error("Invalid referral code");
    }

    if (referrerUser._id.toString() === refereeId.toString()) {
      throw new Error("Users cannot refer themselves");
    }

    const existingReferral = await Referral.findOne({ referee: refereeId });
    if (existingReferral) {
      return existingReferral;
    }

    const referral = await Referral.create({
      referrer: referrerUser._id,
      referee: refereeId,
      referralCode: referralCode.toUpperCase(),
      status: "completed",
      completedAt: new Date(),
      rewardAmount: 10, // Example reward amount
      rewardCurrency: "USDC",
    });

    return referral;
  }

  static async getReferralAnalytics(userId: string): Promise<any> {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const referralCode = await this.getOrCreateReferralCode(userId);
    const referrals = await Referral.find({ referrer: userId }).populate("referee", "name email createdAt");

    const totalInvites = referrals.length;
    const completedInvites = referrals.filter(r => r.status === "completed" || r.status === "rewarded").length;
    const totalRewardsEarned = referrals
      .filter(r => r.status === "rewarded" || r.status === "completed")
      .reduce((sum, r) => sum + (r.rewardAmount || 0), 0);

    return {
      referralCode,
      shareUrl: `https://deenbridge.com/register?ref=${referralCode}`,
      stats: {
        totalInvites,
        completedInvites,
        totalRewardsEarned,
      },
      referrals,
    };
  }
}
