import Transaction from "../src/models/Transaction.js";
import Reel from "../src/models/Reel.js";
import Course from "../src/models/Course.js";

const has = (model, keys) =>
  model.schema.indexes().some(([spec]) => JSON.stringify(spec) === JSON.stringify(keys));

describe("high-traffic model indexes", () => {
  it("Transaction has buyer/creator + createdAt indexes", () => {
    expect(has(Transaction, { buyer: 1, createdAt: -1 })).toBe(true);
    expect(has(Transaction, { creator: 1, createdAt: -1 })).toBe(true);
  });
  it("Reel has creator and tag feed indexes", () => {
    expect(has(Reel, { createdBy: 1, createdAt: -1 })).toBe(true);
    expect(has(Reel, { tags: 1, status: 1, isRemoved: 1, createdAt: -1 })).toBe(true);
  });
  it("Course has category/status index", () => {
    expect(has(Course, { category: 1, status: 1 })).toBe(true);
  });
});
