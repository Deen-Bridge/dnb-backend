import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import GiftClaim from "../../src/models/GiftClaim.js";

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
});

describe("GiftClaim Model", () => {
  it("should validate required fields", async () => {
    const gift = new GiftClaim({});
    let error = null;
    try {
      await gift.validate();
    } catch (e) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(error.errors.sender).toBeDefined();
    expect(error.errors.recipient).toBeDefined();
    expect(error.errors.itemType).toBeDefined();
    expect(error.errors.itemId).toBeDefined();
    expect(error.errors.itemTitle).toBeDefined();
    expect(error.errors.amount).toBeDefined();
    expect(error.errors.status).toBeDefined();
    expect(error.errors.claimExpiryDate).toBeDefined();
    expect(error.errors.network).toBeDefined();
  });

  it("should enforce unique sparse balanceId", async () => {
    const mockId1 = new mongoose.Types.ObjectId();
    const mockId2 = new mongoose.Types.ObjectId();
    const mockItemId = new mongoose.Types.ObjectId();

    const validData = {
      sender: mockId1,
      recipient: mockId2,
      itemType: "course",
      itemId: mockItemId,
      itemTitle: "Test Course",
      amount: "10.00",
      status: "open",
      claimExpiryDate: new Date(Date.now() + 100000),
      network: "testnet",
    };

    // Ensure indexes are built
    await GiftClaim.createIndexes();

    // First doc with a balanceId
    await GiftClaim.create({
      ...validData,
      balanceId: "balance_abc123",
    });

    // Second doc with SAME balanceId should fail
    let duplicateError = null;
    try {
      await GiftClaim.create({
        ...validData,
        balanceId: "balance_abc123",
      });
    } catch (err) {
      duplicateError = err;
    }
    expect(duplicateError).not.toBeNull();
    expect(duplicateError.code).toBe(11000); // duplicate key error

    // Sparse test: multiple docs without balanceId should succeed
    await GiftClaim.create({ ...validData });
    await GiftClaim.create({ ...validData });
    const count = await GiftClaim.countDocuments();
    expect(count).toBe(3);
  });
});
