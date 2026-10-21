import { jest } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const setVapidDetails = jest.fn();
const sendNotification = jest.fn();
const fakeWebPush = { setVapidDetails, sendNotification };

const { default: app } = await import("../app.js");
const { default: User } = await import("../src/models/User.js");
const { default: PushSubscription } = await import("../src/models/PushSubscription.js");
const { default: UserPreferences } = await import("../src/models/UserPreferences.js");
const { sendPushToUser, dispatchWebPush, resetWebPushForTests } = await import(
  "../src/services/webPush.service.js"
);

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";
const goodSub = (endpoint = "https://push.example.com/abc") => ({
  endpoint,
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
});

let mongoServer;
let user;
let other;
let token;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), PushSubscription.deleteMany({}), UserPreferences.deleteMany({})]);
  user = await User.create({ name: "A", email: "a@example.com", password: "Passw0rd!123" });
  other = await User.create({ name: "B", email: "b@example.com", password: "Passw0rd!123" });
  token = jwt.sign({ userId: user._id.toString() }, JWT_SECRET);
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  resetWebPushForTests(fakeWebPush);
  sendNotification.mockReset();
  setVapidDetails.mockReset();
});

const auth = (r) => r.set("Authorization", `Bearer ${token}`);

describe("push-subscription endpoints", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/api/users/push-subscription").send(goodSub());
    expect(res.status).toBe(401);
  });

  it("upserts by endpoint (one row)", async () => {
    expect((await auth(request(app).post("/api/users/push-subscription")).send(goodSub())).status).toBe(201);
    const again = goodSub();
    again.keys.auth = "new-auth";
    expect((await auth(request(app).post("/api/users/push-subscription")).send(again)).status).toBe(201);
    const rows = await PushSubscription.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0].keys.auth).toBe("new-auth");
    expect(String(rows[0].user)).toBe(String(user._id));
  });

  it.each([
    [{ ...goodSub(), endpoint: "http://insecure.example.com/x" }],
    [{ ...goodSub(), endpoint: "not-a-url" }],
    [{ endpoint: "https://push.example.com/x", keys: { p256dh: "", auth: "a" } }],
    [{ endpoint: "https://push.example.com/x", keys: { p256dh: "p" } }],
    [{ endpoint: "https://push.example.com/x" }],
  ])("rejects invalid body %#", async (body) => {
    const res = await auth(request(app).post("/api/users/push-subscription")).send(body);
    expect(res.status).toBe(400);
    expect(await PushSubscription.countDocuments()).toBe(0);
  });

  it("deletes only own subscription", async () => {
    await PushSubscription.create({ user: other._id, ...goodSub("https://push.example.com/other") });
    await PushSubscription.create({ user: user._id, ...goodSub("https://push.example.com/mine") });

    const foreign = await auth(request(app).delete("/api/users/push-subscription")).send({ endpoint: "https://push.example.com/other" });
    expect(foreign.status).toBe(404);
    expect(await PushSubscription.countDocuments()).toBe(2);

    const own = await auth(request(app).delete("/api/users/push-subscription")).send({ endpoint: "https://push.example.com/mine" });
    expect(own.status).toBe(200);
    expect(await PushSubscription.countDocuments()).toBe(1);
  });

  it("updates push preference and validates it", async () => {
    const bad = await auth(request(app).patch("/api/users/push-subscription/preferences")).send({ enabled: "yes" });
    expect(bad.status).toBe(400);
    const ok = await auth(request(app).patch("/api/users/push-subscription/preferences")).send({ enabled: false });
    expect(ok.status).toBe(200);
    const prefs = await UserPreferences.findOne({ user: user._id });
    expect(prefs.notifications.push).toBe(false);
  });
});

describe("web push service", () => {
  const note = { _id: new mongoose.Types.ObjectId(), title: "T", message: "M", type: "follow" };

  it("no-ops without VAPID env", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    resetWebPushForTests(fakeWebPush);
    await PushSubscription.create({ user: user._id, ...goodSub() });
    expect(await sendPushToUser(user._id, { title: "x" })).toEqual({ sent: 0, pruned: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends to each subscription and prunes 410/404 only", async () => {
    await PushSubscription.create({ user: user._id, ...goodSub("https://push.example.com/ok") });
    await PushSubscription.create({ user: user._id, ...goodSub("https://push.example.com/gone") });
    await PushSubscription.create({ user: user._id, ...goodSub("https://push.example.com/err") });
    sendNotification.mockImplementation(async (sub) => {
      if (sub.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (sub.endpoint.endsWith("/err")) throw Object.assign(new Error("boom"), { statusCode: 500 });
    });
    const result = await sendPushToUser(user._id, { title: "x" });
    expect(result).toEqual({ sent: 1, pruned: 1 });
    expect(setVapidDetails).toHaveBeenCalledWith("mailto:test@example.com", "pub", "priv");
    const left = (await PushSubscription.find({})).map((s) => s.endpoint).sort();
    expect(left).toEqual(["https://push.example.com/err", "https://push.example.com/ok"]);
  });

  it("dispatchWebPush respects the push preference", async () => {
    await PushSubscription.create({ user: user._id, ...goodSub() });
    await UserPreferences.create({ user: user._id, notifications: { push: false } });
    await dispatchWebPush(user._id, note);
    expect(sendNotification).not.toHaveBeenCalled();

    await UserPreferences.updateOne({ user: user._id }, { $set: { "notifications.push": true } });
    await dispatchWebPush(user._id, note);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("dispatchWebPush swallows errors", async () => {
    await PushSubscription.create({ user: user._id, ...goodSub() });
    sendNotification.mockRejectedValue(new Error("network"));
    await expect(dispatchWebPush(user._id, note)).resolves.toBeUndefined();
  });
});
