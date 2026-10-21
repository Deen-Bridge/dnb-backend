import NotificationEvent from "../models/NotificationEvent.js";
import logger from "../config/logger.js";

const round = (n) => Math.round(n * 10000) / 10000;
const rate = (num, den) => (den > 0 ? round(num / den) : 0);

/** Record a lifecycle event. Never throws (analytics must not break delivery). */
export const recordEvent = async ({
  notificationId,
  userId,
  type,
  channel = "in_app",
  event,
  timestamp = new Date(),
}) => {
  try {
    return await NotificationEvent.create({
      notificationId,
      userId,
      type,
      channel,
      event,
      timestamp,
    });
  } catch (err) {
    logger.error("Failed to record notification event:", err);
    return null;
  }
};

/**
 * Aggregate counts by type/channel and compute rates.
 * Base = delivered (falls back to sent when nothing was delivered).
 * openRate = opened / base; clickThroughRate = clicked / base.
 */
export const getMetrics = async ({ from, to } = {}) => {
  const match = {};
  if (from || to) {
    match.timestamp = {};
    if (from) match.timestamp.$gte = new Date(from);
    if (to) match.timestamp.$lte = new Date(to);
  }

  const rows = await NotificationEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: { type: "$type", channel: "$channel", event: "$event" },
        count: { $sum: 1 },
      },
    },
  ]);

  const groups = new Map();
  for (const { _id, count } of rows) {
    const key = `${_id.type}|${_id.channel}`;
    if (!groups.has(key)) {
      groups.set(key, {
        type: _id.type,
        channel: _id.channel,
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
      });
    }
    groups.get(key)[_id.event] = count;
  }

  return [...groups.values()].map((g) => {
    const base = g.delivered || g.sent;
    return {
      ...g,
      openRate: rate(g.opened, base),
      clickThroughRate: rate(g.clicked, base),
    };
  });
};

const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const metricsToCsv = (metrics) => {
  const cols = [
    "type",
    "channel",
    "sent",
    "delivered",
    "opened",
    "clicked",
    "openRate",
    "clickThroughRate",
  ];
  return [
    cols.join(","),
    ...metrics.map((m) => cols.map((c) => csvCell(m[c])).join(",")),
  ].join("\n");
};
