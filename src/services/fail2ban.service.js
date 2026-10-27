// Fail2ban-style progressive IP blocking (issue #128).
//
// Redis keys:
//   f2b:fail:<ip>    failure counter, TTL = window
//   f2b:offense:<ip> number of blocks already applied (escalation tier)
//   f2b:block:<ip>   active block (value = tier); TTL = duration, none = permanent
//   f2b:blocked      set of IPs with an active block (for listing)
//
// Fails OPEN: any Redis problem means "not blocked" and failures go unrecorded.
import { getRedisClient, isRedisReady } from "../config/redis.js";
import logger from "../config/logger.js";

const P = "f2b:";
const INDEX = `${P}blocked`;

const intList = (raw, fallback) => {
  const out = String(raw ?? "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return out.length ? out : fallback;
};

export const getConfig = () => {
  const thresholds = intList(process.env.F2B_THRESHOLDS, [5, 5, 3, 3]).map((n) =>
    Math.max(1, n)
  );
  let durations = intList(process.env.F2B_DURATIONS_SEC, [300, 3600, 86400, 0]);
  // 0 = permanent. Disable to cap the last tier at 24h instead.
  if (process.env.F2B_PERMANENT_ENABLED === "false") {
    durations = durations.map((d) => d || 86400);
  }
  return {
    thresholds,
    durations,
    windowSec: parseInt(process.env.F2B_WINDOW_SEC, 10) || 900,
    offenseTtlSec: parseInt(process.env.F2B_OFFENSE_TTL_SEC, 10) || 7 * 86400,
    allowlist: (process.env.F2B_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
};

let override = null;
/** Test hook: inject a Redis-like client (pass null to reset). */
export const _setClient = (c) => {
  override = c;
};

const client = () => {
  if (override) return override;
  return isRedisReady() ? getRedisClient() : null;
};

const normalize = (ip) => String(ip || "").trim().replace(/^::ffff:/i, "");

/** Record a failed attempt. Returns the block info if this failure triggered one. */
export async function recordFailure(ip) {
  const addr = normalize(ip);
  const redis = client();
  if (!addr || !redis) return null;
  const cfg = getConfig();
  if (cfg.allowlist.includes(addr)) return null;
  try {
    if (await redis.exists(`${P}block:${addr}`)) return null;
    const offenses = parseInt((await redis.get(`${P}offense:${addr}`)) || "0", 10);
    const tier = Math.min(offenses, cfg.durations.length - 1);
    const threshold = cfg.thresholds[Math.min(tier, cfg.thresholds.length - 1)];

    const count = await redis.incr(`${P}fail:${addr}`);
    if (count === 1) await redis.expire(`${P}fail:${addr}`, cfg.windowSec);
    if (count < threshold) return null;

    const duration = cfg.durations[tier];
    await redis.del(`${P}fail:${addr}`);
    if (duration > 0) {
      await redis.set(`${P}block:${addr}`, String(tier + 1), { EX: duration });
    } else {
      await redis.set(`${P}block:${addr}`, String(tier + 1)); // permanent
    }
    await redis.sAdd(INDEX, addr);
    await redis.incr(`${P}offense:${addr}`);
    await redis.expire(`${P}offense:${addr}`, cfg.offenseTtlSec);
    logger.warn(
      `IP ${addr} blocked (tier ${tier + 1}, ${duration > 0 ? duration + "s" : "permanent"})`
    );
    return { tier: tier + 1, permanent: duration === 0, durationSec: duration };
  } catch (err) {
    logger.error(`fail2ban.recordFailure failed open: ${err.message}`);
    return null;
  }
}

/** @returns {{blocked:boolean, tier?:number, permanent?:boolean, retryAfterSec?:number}} */
export async function isBlocked(ip) {
  const addr = normalize(ip);
  const redis = client();
  if (!addr || !redis) return { blocked: false };
  try {
    if (getConfig().allowlist.includes(addr)) return { blocked: false };
    const tier = await redis.get(`${P}block:${addr}`);
    if (tier === null || tier === undefined) return { blocked: false };
    const ttl = await redis.ttl(`${P}block:${addr}`);
    return {
      blocked: true,
      tier: parseInt(tier, 10),
      permanent: ttl < 0,
      ...(ttl > 0 && { retryAfterSec: ttl }),
    };
  } catch (err) {
    logger.error(`fail2ban.isBlocked failed open: ${err.message}`);
    return { blocked: false };
  }
}

/** Remove a block and reset escalation history. Returns true if a block existed. */
export async function unblock(ip) {
  const addr = normalize(ip);
  const redis = client();
  if (!addr) return false;
  if (!redis) throw new Error("Redis unavailable");
  const removed = await redis.del(`${P}block:${addr}`);
  await redis.del(`${P}fail:${addr}`);
  await redis.del(`${P}offense:${addr}`);
  await redis.sRem(INDEX, addr);
  return removed > 0;
}

export async function listBlocked() {
  const redis = client();
  if (!redis) throw new Error("Redis unavailable");
  const ips = await redis.sMembers(INDEX);
  const out = [];
  for (const ip of ips) {
    const info = await isBlocked(ip);
    if (info.blocked) out.push({ ip, ...info });
    else await redis.sRem(INDEX, ip); // expired; prune index
  }
  return out;
}

export default { recordFailure, isBlocked, unblock, listBlocked };
