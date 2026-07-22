import request from "supertest";
import mongoose from "mongoose";
import app from "../app.js";
import User from "../src/models/User.js";
import AnchorTransaction from "../src/models/AnchorTransaction.js";

const HOME_DOMAIN = "testanchor.stellar.org";

const userA = {
  name: "Anchor Tracking User A",
  email: "anchor_tracking_a@example.com",
  password: "password123",
  role: "student",
};
const userB = {
  name: "Anchor Tracking User B",
  email: "anchor_tracking_b@example.com",
  password: "password123",
  role: "student",
};

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await User.deleteMany({ email: { $in: [userA.email, userB.email] } });
  await AnchorTransaction.deleteMany({ homeDomain: HOME_DOMAIN });
  await mongoose.disconnect();
});

const registerAndGetToken = async (user) => {
  await User.deleteMany({ email: user.email });
  const res = await request(app).post("/api/auth/register").send(user);
  return { accessToken: res.body.accessToken, userId: res.body.user.id };
};

describe("Anchor transaction ownership isolation", () => {
  it("a user cannot read another user's anchor transaction by id", async () => {
    const a = await registerAndGetToken(userA);
    const b = await registerAndGetToken(userB);

    const ownedByA = await AnchorTransaction.create({
      user: a.userId,
      homeDomain: HOME_DOMAIN,
      kind: "deposit",
      anchorTransactionId: `owned-by-a-${Date.now()}`,
      status: "completed",
    });

    const resAsOwner = await request(app)
      .get(`/api/stellar/anchor/transactions/${ownedByA._id}`)
      .set("Authorization", `Bearer ${a.accessToken}`);
    expect(resAsOwner.statusCode).toBe(200);
    expect(String(resAsOwner.body.transaction._id)).toBe(String(ownedByA._id));

    const resAsStranger = await request(app)
      .get(`/api/stellar/anchor/transactions/${ownedByA._id}`)
      .set("Authorization", `Bearer ${b.accessToken}`);
    expect(resAsStranger.statusCode).toBe(404);
  });

  it("GET /transactions only returns the requesting user's own records", async () => {
    const a = await registerAndGetToken(userA);
    const b = await registerAndGetToken(userB);

    await AnchorTransaction.create([
      {
        user: a.userId,
        homeDomain: HOME_DOMAIN,
        kind: "deposit",
        anchorTransactionId: `a-list-1-${Date.now()}`,
        status: "completed",
      },
      {
        user: b.userId,
        homeDomain: HOME_DOMAIN,
        kind: "withdrawal",
        anchorTransactionId: `b-list-1-${Date.now()}`,
        status: "completed",
      },
    ]);

    const res = await request(app)
      .get("/api/stellar/anchor/transactions")
      .set("Authorization", `Bearer ${a.accessToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.transactions.length).toBeGreaterThan(0);
    for (const tx of res.body.transactions) {
      expect(String(tx.user)).toBe(String(a.userId));
    }
  });

  it("requires auth for both transaction endpoints", async () => {
    const listRes = await request(app).get("/api/stellar/anchor/transactions");
    expect(listRes.statusCode).toBe(401);

    const detailRes = await request(app).get(
      `/api/stellar/anchor/transactions/${new mongoose.Types.ObjectId()}`
    );
    expect(detailRes.statusCode).toBe(401);
  });

  it("returns 404 (not a crash) for a well-formed id that doesn't exist", async () => {
    const a = await registerAndGetToken(userA);
    const res = await request(app)
      .get(`/api/stellar/anchor/transactions/${new mongoose.Types.ObjectId()}`)
      .set("Authorization", `Bearer ${a.accessToken}`);
    expect(res.statusCode).toBe(404);
  });
});
