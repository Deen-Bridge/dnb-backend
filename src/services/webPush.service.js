import PushSubscription from "../models/PushSubscription.js";
import UserPreferences from "../models/UserPreferences.js";
import logger from "../config/logger.js";

let webpushPromise = null;
let injectedWebPush = null;

// web-push is loaded lazily so the app boots even when VAPID is not configured.
const getWebPush = () => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return null;
  if (!webpushPromise) {
    webpushPromise = (injectedWebPush
      ? Promise.resolve(injectedWebPush)
      : import("web-push")
    )
      .then((mod) => {
        const wp = mod.default || mod;
        wp.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        return wp;
      })
      .catch((err) => {
        webpushPromise = null;
        logger.error("Web Push: failed to initialise web-push:", err);
        return null;
      });
  }
  return webpushPromise;
};

// Test seam: lets tests supply a fake web-push implementation.
export const resetWebPushForTests = (fake = null) => {
  webpushPromise = null;
  injectedWebPush = fake;
};

export const isPushEnabledForUser = async (userId) => {
  const prefs = await UserPreferences.findOne({ user: userId })
    .select("notifications.push")
    .lean();
  // Preference defaults to on when no preferences document exists.
  return prefs?.notifications?.push !== false;
};

/**
 * Send a Web Push to all of a user's subscriptions. Dead subscriptions
 * (404/410) are deleted. Returns { sent, pruned }.
 */
export const sendPushToUser = async (userId, payload) => {
  const result = { sent: 0, pruned: 0 };
  const wp = await getWebPush();
  if (!wp) {
    logger.info("Web Push skipped: VAPID env vars not configured");
    return result;
  }

  const subs = await PushSubscription.find({ user: userId }).lean();
  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body
        );
        result.sent += 1;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
          result.pruned += 1;
        } else {
          logger.error(`Web Push send failed (${err?.statusCode || "n/a"}):`, err?.message);
        }
      }
    })
  );
  return result;
};

/**
 * Fire-and-forget hook for the notification creation path. Never throws.
 */
export const dispatchWebPush = async (userId, notification) => {
  try {
    if (!(await isPushEnabledForUser(userId))) return;
    await sendPushToUser(userId, {
      title: notification.title,
      body: notification.message,
      type: notification.type,
      notificationId: String(notification._id),
    });
  } catch (err) {
    logger.error("Web Push dispatch error:", err);
  }
};
