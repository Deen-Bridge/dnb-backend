import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import aggregation, {
  groupBy,
  sumBy,
  countBy,
  averageBy,
  matchStage,
  sortStage,
  limitStage,
  skipStage,
  paginate,
  dateGroup,
  timeSeries,
  buildPipeline,
} from "../aggregation.js";

let mongoServer;

// Test schema: orders with an amount, a category and a creation date.
const testSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  createdAt: { type: Date, required: true },
});

let TestModel;

// Deterministic seed data. Dates chosen so daily/weekly/monthly buckets are
// unambiguous (see per-test comments for the expected ISO week numbers).
const SEED = [
  { amount: 100, category: "A", createdAt: new Date("2026-01-01T10:00:00Z") }, // Thu, 2026-W01, Jan
  { amount: 200, category: "A", createdAt: new Date("2026-01-02T10:00:00Z") }, // Fri, 2026-W01, Jan
  { amount: 50, category: "B", createdAt: new Date("2026-01-08T10:00:00Z") }, // Thu, 2026-W02, Jan
  { amount: 150, category: "B", createdAt: new Date("2026-02-15T10:00:00Z") }, // Sun, 2026-W07, Feb
  { amount: 300, category: "A", createdAt: new Date("2026-02-20T10:00:00Z") }, // Fri, 2026-W08, Feb
];

/** Turn `$group` output into a `{ [_id]: doc }` map for order-independent asserts. */
function byId(rows) {
  return rows.reduce((acc, row) => {
    acc[row._id] = row;
    return acc;
  }, {});
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  TestModel = mongoose.model("TestAggregation", testSchema);
}, 60000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  await TestModel.deleteMany({});
  await TestModel.create(SEED);
});

describe("groupBy", () => {
  it("groups by a single field with custom accumulators", async () => {
    const stage = groupBy("category", { total: { $sum: "$amount" }, n: { $sum: 1 } });
    expect(stage).toEqual({
      $group: { _id: "$category", total: { $sum: "$amount" }, n: { $sum: 1 } },
    });

    const rows = byId(await TestModel.aggregate([stage]));
    expect(rows.A).toMatchObject({ total: 600, n: 3 });
    expect(rows.B).toMatchObject({ total: 200, n: 2 });
  });

  it("groups over the whole collection when field is null", async () => {
    const stage = groupBy(null, { total: { $sum: "$amount" } });
    expect(stage).toEqual({ $group: { _id: null, total: { $sum: "$amount" } } });

    const rows = await TestModel.aggregate([stage]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ _id: null, total: 800 });
  });

  it("accepts a field already prefixed with $", () => {
    expect(groupBy("$category", { n: { $sum: 1 } })).toEqual({
      $group: { _id: "$category", n: { $sum: 1 } },
    });
  });

  it("throws when accumulators is missing or empty", () => {
    expect(() => groupBy("category")).toThrow(TypeError);
    expect(() => groupBy("category", {})).toThrow(TypeError);
  });
});

describe("sumBy", () => {
  it("sums grouped by a field", async () => {
    const stage = sumBy("amount", "category");
    expect(stage).toEqual({ $group: { _id: "$category", total: { $sum: "$amount" } } });

    const rows = byId(await TestModel.aggregate([stage]));
    expect(rows.A.total).toBe(600);
    expect(rows.B.total).toBe(200);
  });

  it("sums the whole collection when groupField is null", async () => {
    const rows = await TestModel.aggregate([sumBy("amount")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(800);
  });

  it("supports a custom output name", () => {
    expect(sumBy("amount", null, "revenue")).toEqual({
      $group: { _id: null, revenue: { $sum: "$amount" } },
    });
  });

  it("throws on an invalid field", () => {
    expect(() => sumBy("")).toThrow(TypeError);
    expect(() => sumBy(null)).toThrow(TypeError);
  });
});

describe("countBy", () => {
  it("counts documents per distinct value", async () => {
    const stage = countBy("category");
    expect(stage).toEqual({ $group: { _id: "$category", count: { $sum: 1 } } });

    const rows = byId(await TestModel.aggregate([stage]));
    expect(rows.A.count).toBe(3);
    expect(rows.B.count).toBe(2);
  });

  it("supports a custom output name", () => {
    expect(countBy("category", "occurrences")).toEqual({
      $group: { _id: "$category", occurrences: { $sum: 1 } },
    });
  });

  it("throws on an invalid field", () => {
    expect(() => countBy("")).toThrow(TypeError);
  });
});

describe("averageBy", () => {
  it("averages grouped by a field", async () => {
    const stage = averageBy("amount", "category");
    expect(stage).toEqual({ $group: { _id: "$category", average: { $avg: "$amount" } } });

    const rows = byId(await TestModel.aggregate([stage]));
    expect(rows.A.average).toBe(200); // (100+200+300)/3
    expect(rows.B.average).toBe(100); // (50+150)/2
  });

  it("averages the whole collection when groupField is null", async () => {
    const rows = await TestModel.aggregate([averageBy("amount")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].average).toBe(160); // 800/5
  });

  it("throws on an invalid field", () => {
    expect(() => averageBy(undefined)).toThrow(TypeError);
  });
});

describe("thin stage builders", () => {
  it("matchStage wraps a filter", () => {
    expect(matchStage({ category: "A" })).toEqual({ $match: { category: "A" } });
  });

  it("matchStage throws on a non-object", () => {
    expect(() => matchStage(null)).toThrow(TypeError);
    expect(() => matchStage([])).toThrow(TypeError);
  });

  it("sortStage wraps a spec", () => {
    expect(sortStage({ total: -1 })).toEqual({ $sort: { total: -1 } });
  });

  it("sortStage throws on an empty spec", () => {
    expect(() => sortStage({})).toThrow(TypeError);
  });

  it("limitStage validates a positive integer", () => {
    expect(limitStage(5)).toEqual({ $limit: 5 });
    expect(() => limitStage(0)).toThrow(TypeError);
    expect(() => limitStage(-1)).toThrow(TypeError);
    expect(() => limitStage(2.5)).toThrow(TypeError);
  });

  it("skipStage validates a non-negative integer", () => {
    expect(skipStage(0)).toEqual({ $skip: 0 });
    expect(skipStage(10)).toEqual({ $skip: 10 });
    expect(() => skipStage(-1)).toThrow(TypeError);
  });

  it("paginate builds a skip/limit pair", () => {
    expect(paginate(1, 10)).toEqual([{ $skip: 0 }, { $limit: 10 }]);
    expect(paginate(3, 20)).toEqual([{ $skip: 40 }, { $limit: 20 }]);
  });

  it("paginate throws on a bad page", () => {
    expect(() => paginate(0, 10)).toThrow(TypeError);
  });
});

describe("dateGroup", () => {
  it("builds the daily bucket key", () => {
    expect(dateGroup("createdAt", "daily")).toEqual({
      $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" },
    });
  });

  it("builds the weekly bucket key", () => {
    expect(dateGroup("createdAt", "weekly")).toEqual({
      $dateToString: { format: "%G-W%V", date: "$createdAt", timezone: "UTC" },
    });
  });

  it("builds the monthly bucket key", () => {
    expect(dateGroup("createdAt", "monthly")).toEqual({
      $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" },
    });
  });

  it("passes through a custom timezone", () => {
    expect(dateGroup("createdAt", "daily", "America/New_York")).toEqual({
      $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "America/New_York" },
    });
  });

  it("throws on an unsupported granularity", () => {
    expect(() => dateGroup("createdAt", "yearly")).toThrow(TypeError);
    expect(() => dateGroup("createdAt")).toThrow(TypeError);
  });

  it("throws on an invalid field or timezone", () => {
    expect(() => dateGroup("", "daily")).toThrow(TypeError);
    expect(() => dateGroup("createdAt", "daily", "")).toThrow(TypeError);
  });
});

describe("timeSeries", () => {
  it("buckets daily and sorts ascending", async () => {
    const pipeline = timeSeries("createdAt", { granularity: "daily", valueField: "amount", op: "sum" });
    const rows = await TestModel.aggregate(pipeline);

    expect(rows.map((r) => r._id)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-08",
      "2026-02-15",
      "2026-02-20",
    ]);
    expect(rows.map((r) => r.value)).toEqual([100, 200, 50, 150, 300]);
  });

  it("buckets weekly (ISO week) and sums", async () => {
    const pipeline = timeSeries("createdAt", { granularity: "weekly", valueField: "amount", op: "sum" });
    const rows = byId(await TestModel.aggregate(pipeline));

    expect(rows["2026-W01"].value).toBe(300); // 100 + 200
    expect(rows["2026-W02"].value).toBe(50);
    expect(rows["2026-W07"].value).toBe(150);
    expect(rows["2026-W08"].value).toBe(300);
  });

  it("buckets monthly and sums", async () => {
    const pipeline = timeSeries("createdAt", { granularity: "monthly", valueField: "amount", op: "sum" });
    const rows = await TestModel.aggregate(pipeline);

    expect(rows.map((r) => r._id)).toEqual(["2026-01", "2026-02"]); // sorted ascending
    expect(byId(rows)["2026-01"].value).toBe(350); // 100 + 200 + 50
    expect(byId(rows)["2026-02"].value).toBe(450); // 150 + 300
  });

  it("counts documents per bucket with op=count", async () => {
    const pipeline = timeSeries("createdAt", { granularity: "monthly", op: "count" });
    const rows = byId(await TestModel.aggregate(pipeline));

    expect(rows["2026-01"].value).toBe(3);
    expect(rows["2026-02"].value).toBe(2);
  });

  it("averages per bucket with op=avg", async () => {
    const pipeline = timeSeries("createdAt", { granularity: "monthly", valueField: "amount", op: "avg" });
    const rows = byId(await TestModel.aggregate(pipeline));

    expect(rows["2026-01"].value).toBeCloseTo(350 / 3);
    expect(rows["2026-02"].value).toBe(225);
  });

  it("honours the timezone when bucketing across a day boundary", async () => {
    await TestModel.deleteMany({});
    // 02:00 UTC on Mar 1 is still Feb 28 in New York (UTC-5, pre-DST).
    await TestModel.create({ amount: 10, category: "C", createdAt: new Date("2026-03-01T02:00:00Z") });

    const utc = await TestModel.aggregate(
      timeSeries("createdAt", { granularity: "daily", valueField: "amount", op: "sum" })
    );
    expect(utc[0]._id).toBe("2026-03-01");

    const ny = await TestModel.aggregate(
      timeSeries("createdAt", { granularity: "daily", valueField: "amount", op: "sum", timezone: "America/New_York" })
    );
    expect(ny[0]._id).toBe("2026-02-28");
  });

  it("throws on a missing valueField for a non-count op", () => {
    expect(() => timeSeries("createdAt", { granularity: "daily", op: "sum" })).toThrow(TypeError);
  });

  it("throws on an unsupported op", () => {
    expect(() =>
      timeSeries("createdAt", { granularity: "daily", valueField: "amount", op: "median" })
    ).toThrow(TypeError);
  });

  it("throws on an unsupported granularity", () => {
    expect(() =>
      timeSeries("createdAt", { granularity: "hourly", valueField: "amount" })
    ).toThrow(TypeError);
  });
});

describe("buildPipeline", () => {
  it("composes stages in canonical order", () => {
    const pipeline = buildPipeline({
      match: { category: "A" },
      group: sumBy("amount", "category"),
      sort: { total: -1 },
      skip: 0,
      limit: 5,
    });

    expect(pipeline).toEqual([
      { $match: { category: "A" } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
      { $skip: 0 },
      { $limit: 5 },
    ]);
  });

  it("omits absent and empty parts", () => {
    expect(buildPipeline({})).toEqual([]);
    expect(buildPipeline({ match: {}, sort: {} })).toEqual([]);
    expect(buildPipeline({ limit: 3 })).toEqual([{ $limit: 3 }]);
  });

  it("accepts a bare group body and wraps it in $group", () => {
    const pipeline = buildPipeline({ group: { _id: "$category", total: { $sum: "$amount" } } });
    expect(pipeline).toEqual([{ $group: { _id: "$category", total: { $sum: "$amount" } } }]);
  });

  it("inlines an array of group stages", () => {
    const pipeline = buildPipeline({
      group: timeSeries("createdAt", { granularity: "monthly", op: "count" }),
    });
    expect(pipeline).toEqual([
      { $group: { _id: dateGroup("createdAt", "monthly"), value: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
  });

  it("runs end-to-end against the model", async () => {
    const pipeline = buildPipeline({
      group: sumBy("amount", "category"),
      sort: { total: -1 },
      limit: 1,
    });
    const rows = await TestModel.aggregate(pipeline);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ _id: "A", total: 600 }); // highest total first
  });

  it("throws on a malformed part", () => {
    expect(() => buildPipeline({ match: [] })).toThrow(TypeError);
    expect(() => buildPipeline({ sort: 5 })).toThrow(TypeError);
    expect(() => buildPipeline({ limit: -1 })).toThrow(TypeError);
  });
});

describe("aggregation (default export)", () => {
  it("exposes all named helpers", () => {
    for (const name of [
      "groupBy",
      "sumBy",
      "countBy",
      "averageBy",
      "matchStage",
      "sortStage",
      "limitStage",
      "skipStage",
      "paginate",
      "dateGroup",
      "timeSeries",
      "buildPipeline",
    ]) {
      expect(typeof aggregation[name]).toBe("function");
    }
  });
});
