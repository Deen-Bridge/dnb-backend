import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import app from "../app.js";
import User from "../src/models/User.js";
import activeUsersService from "../src/services/analytics/activeUsersService.js";
import { seedUserAndLogin } from "./helpers/testAuth.js";

// Minimal Redis-compatible in-memory client covering exactly the commands the
// active-users service uses (zAdd / zRemRangeByScore / zCard). The real Redis
// connection is unavailable in the test environment, so this fake stands in at
// the client seam — everything above it (middleware -> service -> endpoint) is
// exercised for real.
const createFakeRedis = () => {
  const store = new Map(); // member -> score
  return {
    _store: store,
    async zAdd(_key, members) {
      for (const member of members) store.set(member.value, member.score);
      return members.length;
    },
    async zRemRangeByScore(_key, min, max) {
      let removed = 0;
      for (const [member, score] of store) {
        if (score >= min && score <= max) {
          store.delete(member);
          removed += 1;
        }
      }
      return removed;
    },
    async zCard() {
      return store.size;
    },
  };
};

describe("Real-time active users tracking (#243)", () => {
  let mongoServer;
  let readerToken;
  let authorToken;
  let fakeRedis;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    const reader = await seedUserAndLogin(app, {
      name: "Active Reader",
      email: "active-reader@example.com",
    });
    readerToken = reader.token;

    const author = await seedUserAndLogin(app, {
      name: "Active Author",
      email: "active-author@example.com",
      role: "mentor",
    });
    authorToken = author.token;
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(() => {
    // NOTE: seeded users are intentionally kept — their login tokens from
    // beforeAll must stay valid. Only the Redis state is reset per test.
    fakeRedis = createFakeRedis();
    activeUsersService.setRedis(fakeRedis);
    activeUsersService.setTimeoutSeconds(300);
  });

  afterEach(() => {
    activeUsersService.setRedis(null);
  });

  it("requires authentication to read the active-user count", async () => {
    const res = await request(app).get("/api/analytics/active-users");

    expect(res.status).toBe(401);
  });

  it("counts the requesting user via the activity middleware", async () => {
    const res = await request(app)
      .get("/api/analytics/active-users")
      .set("Authorization", `Bearer ${readerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.timeoutSeconds).toBe(300);
    // The middleware tracked this very request before the handler counted.
    expect(res.body.activeUsers).toBeGreaterThanOrEqual(1);
    expect(fakeRedis._store.size).toBeGreaterThanOrEqual(1);
  });

  it("counts each unique user once and ignores repeated activity", async () => {
    await request(app)
      .get("/api/analytics/active-users")
      .set("Authorization", `Bearer ${readerToken}`);
    await request(app)
      .get("/api/analytics/active-users")
      .set("Authorization", `Bearer ${authorToken}`);

    const res = await request(app)
      .get("/api/analytics/active-users")
      .set("Authorization", `Bearer ${readerToken}`);

    expect(res.body.activeUsers).toBe(2);
  });

  it("expires users who have been idle longer than the timeout", async () => {
    // Seed one fresh entry (via the service) and one stale entry directly.
    await activeUsersService.trackActivity({ userId: "fresh-user" });
    const staleScore = Date.now() - activeUsersService.getTimeoutSeconds() * 1000 - 1000;
    fakeRedis._store.set("stale-user", staleScore);

    const count = await activeUsersService.getActiveUserCount();

    expect(count).toBe(1);
    expect(fakeRedis._store.has("stale-user")).toBe(false);
  });

  it("respects a shorter timeout via the environment override seam", async () => {
    activeUsersService.setTimeoutSeconds(60);
    await activeUsersService.trackActivity({ userId: "fresh-user" });
    const staleScore = Date.now() - 61 * 1000;
    fakeRedis._store.set("stale-user", staleScore);

    const count = await activeUsersService.getActiveUserCount();

    expect(count).toBe(1);
  });

  it("returns 0 without error when Redis is unavailable", async () => {
    activeUsersService.setRedis(null);

    const res = await request(app)
      .get("/api/analytics/active-users")
      .set("Authorization", `Bearer ${readerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.activeUsers).toBe(0);
  });
});
