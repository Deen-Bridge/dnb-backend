import { jest } from "@jest/globals";

// storeAnchorJwt/getStoredAnchorJwt are thin wrappers around utils/cache.js.
// cache.js's own Redis-backed behavior is exercised by its existing callers
// elsewhere; here we verify OUR key construction and exp-based expiry
// contract against a fake in-memory cache, since jest.spyOn cannot mutate a
// local ESM module's live-bound named exports (only jest.unstable_mockModule
// can substitute the whole module).
const fakeStore = new Map();

jest.unstable_mockModule("../src/utils/cache.js", () => ({
  setCacheExpireAt: jest.fn(async (key, value, timestamp) => {
    fakeStore.set(key, { value, expiresAt: timestamp });
    return true;
  }),
  getCache: jest.fn(async (key) => {
    const entry = fakeStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt * 1000 <= Date.now()) {
      fakeStore.delete(key);
      return null;
    }
    return entry.value;
  }),
  getCacheOrSet: jest.fn(async (key, fallbackFn) => fallbackFn()),
}));

const { storeAnchorJwt, getStoredAnchorJwt } = await import(
  "../src/services/stellar/anchorService.js"
);
const cache = await import("../src/utils/cache.js");

describe("anchor JWT storage", () => {
  beforeEach(() => {
    fakeStore.clear();
    jest.clearAllMocks();
  });

  it("stores the JWT keyed by (userId, homeDomain) with the token's own exp as TTL", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await storeAnchorJwt("user-1", "testanchor.stellar.org", "the-jwt-value", exp);

    expect(cache.setCacheExpireAt).toHaveBeenCalledWith(
      "anchor:jwt:user-1:testanchor.stellar.org",
      { token: "the-jwt-value" },
      exp
    );
  });

  it("round-trips a stored token back out", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await storeAnchorJwt("user-1", "testanchor.stellar.org", "the-jwt-value", exp);

    const token = await getStoredAnchorJwt("user-1", "testanchor.stellar.org");
    expect(token).toBe("the-jwt-value");
  });

  it("keys are isolated per (userId, homeDomain) pair", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await storeAnchorJwt("user-1", "anchor-a.example.com", "token-a", exp);
    await storeAnchorJwt("user-1", "anchor-b.example.com", "token-b", exp);
    await storeAnchorJwt("user-2", "anchor-a.example.com", "token-c", exp);

    expect(await getStoredAnchorJwt("user-1", "anchor-a.example.com")).toBe("token-a");
    expect(await getStoredAnchorJwt("user-1", "anchor-b.example.com")).toBe("token-b");
    expect(await getStoredAnchorJwt("user-2", "anchor-a.example.com")).toBe("token-c");
  });

  it("returns null (not an error) for a token that has never been stored", async () => {
    const token = await getStoredAnchorJwt("stranger", "testanchor.stellar.org");
    expect(token).toBeNull();
  });

  it("returns null once the stored token's exp has elapsed, exactly like never-stored - the caller can't distinguish 'expired' from 'no session' and treats both as 're-authenticate'", async () => {
    const alreadyExpired = Math.floor(Date.now() / 1000) - 10;
    await storeAnchorJwt("user-1", "testanchor.stellar.org", "stale-jwt", alreadyExpired);

    const token = await getStoredAnchorJwt("user-1", "testanchor.stellar.org");
    expect(token).toBeNull();
  });
});
