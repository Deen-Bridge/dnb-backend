import PushSubscription from "../models/PushSubscription.js";
import UserPreferences from "../models/UserPreferences.js";

export const upsertPushSubscription = async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body;
    const sub = await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        $set: {
          user: req.user._id,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          userAgent: req.get("user-agent") || "",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ success: true, data: { id: sub._id, endpoint: sub.endpoint } });
  } catch (err) {
    next(err);
  }
};

export const deletePushSubscription = async (req, res, next) => {
  try {
    const result = await PushSubscription.deleteOne({
      endpoint: req.body.endpoint,
      user: req.user._id,
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Subscription not found" });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const updatePushPreference = async (req, res, next) => {
  try {
    const prefs = await UserPreferences.findOneAndUpdate(
      { user: req.user._id },
      { $set: { "notifications.push": req.body.enabled } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: { push: prefs.notifications.push } });
  } catch (err) {
    next(err);
  }
};
