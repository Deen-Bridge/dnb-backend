import { jest } from "@jest/globals";
import {
  recordFailure,
  isBlocked,
  unblock,
  listBlocked,
  _setClient,
} from "../src/services/fail2ban.service.js";
import { ipBlockMiddleware } from "../src/middlewares/ipBlock.js";

class FakeRedis {
  constructor() {
    this.kv = new Map();
    this.sets = new Map();
    this.now = 0;
  }
  _live(k) {
    const e = this.kv.get(k);
    if (e && e.exp !== null && e.exp <= this.now) this.kv.delete(k);
    return this.kv.get(k);
  }
  async get(k) { const e = this._live(k); return e ? e.v : null; }
  async exists(k) { return this._live(k) ? 1 : 0; }
  async set(k, v, o) { this.kv.set(k, { v: String(v), exp: o?.EX ? this.now + o.EX : null }); }
  async incr(k) {
    const e = this._live(k);
    const n = (e ? parseInt(e.v, 10) : 0) + 1;
    this.kv.set(k, { v: String(n), exp: e ? e.exp : null });
    return n;
  }
  async expire(k, s) { const e = this._live(k); if (e) e.exp = this.now + s; }
  async ttl(k) { const e = this._live(k); if (!e) return -2; return e.exp === null ? -1 : e.exp - this.now; }
  async del(k) { return this._live(k) && this.kv.delete(k) ? 1 : 0; }
  async sAdd(k, m) { (this.sets.get(k) || this.sets.set(k, new Set()).get(k)).add(m); }
  async sRem(k, m) { this.sets.get(k)?.delete(m); }
  async sMembers(k) { return [...(this.sets.get(k) || [])]; }
}

const IP = "203.0.113.9";
let r;
const fail = async (n) => { let last; for (let i = 0; i < n; i++) last = await recordFailure(IP); return last; };

beforeEach(() => {
  r = new FakeRedis();
  _setClient(r);
  process.env.F2B_THRESHOLDS = "3,2,2";
  process.env.F2B_DURATIONS_SEC = "300,3600,0";
  delete process.env.F2B_PERMANENT_ENABLED;
  delete process.env.F2B_ALLOWLIST;
});
afterAll(() => _setClient(null));

describe("fail2ban service", () => {
  test("blocks only after threshold with tier-1 TTL", async () => {
    expect(await fail(2)).toBeNull();
    expect((await isBlocked(IP)).blocked).toBe(false);
    expect(await recordFailure(IP)).toMatchObject({ tier: 1, durationSec: 300 });
    expect(await isBlocked(IP)).toMatchObject({ blocked: true, tier: 1, retryAfterSec: 300, permanent: false });
  });

  test("block expires after TTL", async () => {
    await fail(3);
    r.now = 301;
    expect((await isBlocked(IP)).blocked).toBe(false);
  });

  test("escalates 5min -> 1hr -> permanent", async () => {
    await fail(3);
    r.now = 301;
    expect(await fail(2)).toMatchObject({ tier: 2, durationSec: 3600 });
    r.now += 3601;
    expect(await fail(2)).toMatchObject({ tier: 3, permanent: true });
    r.now += 10 * 86400 * 365;
    expect(await isBlocked(IP)).toMatchObject({ blocked: true, permanent: true });
  });

  test("permanent can be capped to 24h via env", async () => {
    process.env.F2B_PERMANENT_ENABLED = "false";
    process.env.F2B_DURATIONS_SEC = "0";
    expect(await fail(3)).toMatchObject({ durationSec: 86400, permanent: false });
  });

  test("unblock removes block and resets escalation; listBlocked reflects state", async () => {
    await fail(3);
    expect(await listBlocked()).toEqual([expect.objectContaining({ ip: IP, tier: 1 })]);
    expect(await unblock(IP)).toBe(true);
    expect((await isBlocked(IP)).blocked).toBe(false);
    expect(await listBlocked()).toEqual([]);
    expect(await unblock(IP)).toBe(false);
    expect(await fail(3)).toMatchObject({ tier: 1 });
  });

  test("allowlisted IPs are never blocked", async () => {
    process.env.F2B_ALLOWLIST = IP;
    expect(await fail(10)).toBeNull();
    expect((await isBlocked(IP)).blocked).toBe(false);
  });

  test("fails open when Redis is unavailable or throws", async () => {
    _setClient(null); // no override, redis not ready in tests
    expect(await recordFailure(IP)).toBeNull();
    expect((await isBlocked(IP)).blocked).toBe(false);
    _setClient({ get: async () => { throw new Error("down"); }, exists: async () => { throw new Error("down"); } });
    expect(await recordFailure(IP)).toBeNull();
    expect((await isBlocked(IP)).blocked).toBe(false);
  });
});

describe("ipBlockMiddleware", () => {
  const run = async () => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    const next = jest.fn();
    await ipBlockMiddleware({ ip: IP }, res, next);
    return { res, next };
  };
  test("passes unblocked, rejects blocked with 429 + standard shape", async () => {
    expect((await run()).next).toHaveBeenCalled();
    await fail(3);
    const { res, next } = await run();
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(429);
    expect(res.headers["Retry-After"]).toBe("300");
    expect(res.body).toMatchObject({ success: false, error: { code: "RATE_LIMITED" } });
  });
  test("fails open on Redis error", async () => {
    _setClient({ get: async () => { throw new Error("x"); } });
    expect((await run()).next).toHaveBeenCalled();
  });
});
