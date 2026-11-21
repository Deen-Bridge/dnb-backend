import crypto from "node:crypto";
import Notification from "../models/Notification.js";

export const upsertDurableNotification = async (notificationData) => {
  const eventId = notificationData.eventId || crypto.randomUUID();
  const recipient = notificationData.recipient.toString();
  const deduplicationKey =
    notificationData.deduplicationKey || `${eventId}:${recipient}`;
  const { eventId: _eventId, deduplicationKey: _key, ...payload } = notificationData;

  return Notification.findOneAndUpdate(
    { recipient, deduplicationKey },
    { $setOnInsert: { ...payload, recipient, eventId, deduplicationKey } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};
