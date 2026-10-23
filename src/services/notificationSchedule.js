/** Return whether a local clock time falls inside a recurring DND window. */
export const isWithinDoNotDisturbWindow = (date, schedule = {}) => {
  if (!schedule.enabled || !schedule.start || !schedule.end) return false;
  const timezone = schedule.timezone || "UTC";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const current = hour * 60 + minute;
  const parse = (value) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
  const start = parse(schedule.start), end = parse(schedule.end);
  return start <= end ? current >= start && current < end : current >= start || current < end;
};
