export const SPACE_STATUSES = ["upcoming", "live", "ended", "cancelled"];
export const SPACE_TRANSITIONS = {
  upcoming: new Set(["live", "cancelled"]),
  live: new Set(["ended", "cancelled"]),
  ended: new Set(),
  cancelled: new Set(),
};

const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 24 * 60;

export function validateSpaceSchedule({ eventDate, eventTime, duration, price }, { requireFuture = true } = {}) {
  const date = new Date(eventDate);
  if (!eventDate || Number.isNaN(date.getTime())) throw new Error("eventDate must be a valid date");
  if (requireFuture && date.getTime() <= Date.now()) throw new Error("eventDate must be in the future");
  if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(String(eventTime || ""))) {
    throw new Error("eventTime must use HH:mm format");
  }
  const minutes = Number(duration);
  if (!Number.isInteger(minutes) || minutes < MIN_DURATION_MINUTES || minutes > MAX_DURATION_MINUTES) {
    throw new Error(`duration must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes`);
  }
  const amount = Number(price ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("price must be a non-negative number");
  return { date, duration: minutes, price: amount };
}

export function assertSpaceTransition(from, to) {
  if (!SPACE_STATUSES.includes(to)) throw new Error("Invalid space status");
  if (from === to) return;
  if (!SPACE_TRANSITIONS[from]?.has(to)) throw new Error(`Cannot transition space from ${from} to ${to}`);
}
