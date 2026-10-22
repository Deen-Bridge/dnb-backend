import { jest } from "@jest/globals";
import cursorPagination, {
  encodeCursor,
  decodeCursor,
  buildCursorFromDoc,
  buildCursorFilter,
  buildSort,
  paginate,
} from "../cursorPagination.js";

/**
 * A tiny in-memory "collection" that mimics the slice of MongoDB behaviour the
 * paginate helper relies on: apply a filter, sort, and limit. It is only rich
 * enough to exercise the pure helpers — no database or network is involved.
 */
const makeExecutor = (docs) => ({ filter, sort, limit }) => {
  const matches = docs.filter((doc) => matchesFilter(doc, filter));
  const [[field, order]] = Object.entries(sort);
  const sorted = matches.sort((a, b) => compare(a, b, field, order));
  return sorted.slice(0, limit);
};

const compare = (a, b, field, order) => {
  if (a[field] < b[field]) return -1 * order;
  if (a[field] > b[field]) return 1 * order;
  // Deterministic _id tiebreaker, mirroring buildSort.
  if (a._id < b._id) return -1 * order;
  if (a._id > b._id) return 1 * order;
  return 0;
};

const matchesFilter = (doc, filter) => {
  if (!filter || Object.keys(filter).length === 0) return true;
  if (filter.$and) return filter.$and.every((f) => matchesFilter(doc, f));
  if (filter.$or) return filter.$or.some((f) => matchesFilter(doc, f));
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, operand]) => {
        if (op === "$gt") return value > operand;
        if (op === "$lt") return value < operand;
        if (op === "$gte") return value >= operand;
        if (op === "$lte") return value <= operand;
        return false;
      });
    }
    return value === cond;
  });
};

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a simple _id payload", () => {
    const payload = { id: "abc123" };
    const cursor = encodeCursor(payload);
    expect(typeof cursor).toBe("string");
    expect(decodeCursor(cursor)).toEqual(payload);
  });

  it("round-trips a compound {field, _id} payload", () => {
    const payload = { v: "2020-01-01T00:00:00.000Z", id: "xyz" };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it("produces URL-safe output with no padding", () => {
    const cursor = encodeCursor({ v: "a=b/c+d?", id: "??????" });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it("rejects an empty or non-string cursor on decode", () => {
    expect(() => decodeCursor("")).toThrow(TypeError);
    expect(() => decodeCursor(null)).toThrow(TypeError);
  });

  it("rejects a null payload on encode", () => {
    expect(() => encodeCursor(null)).toThrow(TypeError);
  });
});

describe("buildCursorFromDoc", () => {
  it("encodes only the id when sorting by _id", () => {
    const cursor = buildCursorFromDoc({ _id: "42", name: "z" });
    expect(decodeCursor(cursor)).toEqual({ id: "42" });
  });

  it("encodes {field value, _id} when sorting by a non-_id field", () => {
    const cursor = buildCursorFromDoc({ _id: "42", createdAt: "2021" }, "createdAt");
    expect(decodeCursor(cursor)).toEqual({ v: "2021", id: "42" });
  });

  it("normalises Date values to ISO strings", () => {
    const when = new Date("2022-06-15T12:00:00.000Z");
    const cursor = buildCursorFromDoc({ _id: "1", createdAt: when }, "createdAt");
    expect(decodeCursor(cursor)).toEqual({ v: when.toISOString(), id: "1" });
  });

  it("throws when the document has no _id", () => {
    expect(() => buildCursorFromDoc({ name: "x" })).toThrow(TypeError);
  });
});

describe("buildSort", () => {
  it("sorts by _id only when that is the field", () => {
    expect(buildSort("_id", 1, "forward")).toEqual({ _id: 1 });
  });

  it("adds an _id tiebreaker for non-_id fields", () => {
    expect(buildSort("createdAt", 1, "forward")).toEqual({ createdAt: 1, _id: 1 });
  });

  it("reverses the sort for backward pagination", () => {
    expect(buildSort("createdAt", 1, "backward")).toEqual({ createdAt: -1, _id: -1 });
    expect(buildSort("_id", -1, "backward")).toEqual({ _id: 1 });
  });
});

describe("buildCursorFilter", () => {
  it("uses $gt for ascending forward on _id", () => {
    const filter = buildCursorFilter({ cursor: { id: "5" }, sortField: "_id", sortOrder: 1 });
    expect(filter).toEqual({ _id: { $gt: "5" } });
  });

  it("uses $lt for ascending backward on _id", () => {
    const filter = buildCursorFilter({
      cursor: { id: "5" },
      sortField: "_id",
      sortOrder: 1,
      direction: "backward",
    });
    expect(filter).toEqual({ _id: { $lt: "5" } });
  });

  it("inverts the operator for a descending sort", () => {
    const filter = buildCursorFilter({ cursor: { id: "5" }, sortField: "_id", sortOrder: -1 });
    expect(filter).toEqual({ _id: { $lt: "5" } });
  });

  it("builds a compound $or predicate for a non-_id field", () => {
    const filter = buildCursorFilter({
      cursor: { v: "2021", id: "5" },
      sortField: "createdAt",
      sortOrder: 1,
      direction: "forward",
    });
    expect(filter).toEqual({
      $or: [{ createdAt: { $gt: "2021" } }, { createdAt: "2021", _id: { $gt: "5" } }],
    });
  });

  it("throws without a decoded cursor", () => {
    expect(() => buildCursorFilter({ cursor: null })).toThrow(TypeError);
  });
});

describe("paginate (forward and backward)", () => {
  const docs = [
    { _id: "1", name: "a" },
    { _id: "2", name: "b" },
    { _id: "3", name: "c" },
    { _id: "4", name: "d" },
    { _id: "5", name: "e" },
  ];

  it("validates its arguments", async () => {
    await expect(paginate({})).rejects.toThrow(TypeError);
    await expect(paginate({ executor: () => [], limit: 0 })).rejects.toThrow(TypeError);
    await expect(
      paginate({ executor: () => [], after: "a", before: "b" })
    ).rejects.toThrow(TypeError);
  });

  it("returns the first page and reports a next page", async () => {
    const result = await paginate({ executor: makeExecutor(docs), limit: 2 });
    expect(result.nodes.map((d) => d._id)).toEqual(["1", "2"]);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.hasPreviousPage).toBe(false);
    expect(result.edges).toHaveLength(2);
    expect(result.pageInfo.startCursor).toBe(result.edges[0].cursor);
    expect(result.pageInfo.endCursor).toBe(result.edges[1].cursor);
  });

  it("walks forward across every page with `after`", async () => {
    const executor = makeExecutor(docs);
    const first = await paginate({ executor, limit: 2 });
    const second = await paginate({ executor, limit: 2, after: first.pageInfo.endCursor });
    expect(second.nodes.map((d) => d._id)).toEqual(["3", "4"]);
    expect(second.pageInfo.hasNextPage).toBe(true);
    expect(second.pageInfo.hasPreviousPage).toBe(true);

    const third = await paginate({ executor, limit: 2, after: second.pageInfo.endCursor });
    expect(third.nodes.map((d) => d._id)).toEqual(["5"]);
    expect(third.pageInfo.hasNextPage).toBe(false);
  });

  it("walks backward with `before`, restoring ascending order", async () => {
    const executor = makeExecutor(docs);
    // Jump forward to the last page, then page backward from its first cursor.
    const first = await paginate({ executor, limit: 2 });
    const second = await paginate({ executor, limit: 2, after: first.pageInfo.endCursor });
    const back = await paginate({
      executor,
      limit: 2,
      before: second.pageInfo.startCursor,
    });
    expect(back.nodes.map((d) => d._id)).toEqual(["1", "2"]);
    expect(back.pageInfo.hasPreviousPage).toBe(false);
    expect(back.pageInfo.hasNextPage).toBe(true);
  });

  it("supports a descending sort on a non-_id field", async () => {
    const executor = makeExecutor(docs);
    const result = await paginate({
      executor,
      sortField: "name",
      sortOrder: -1,
      limit: 2,
    });
    expect(result.nodes.map((d) => d._id)).toEqual(["5", "4"]);
    const next = await paginate({
      executor,
      sortField: "name",
      sortOrder: -1,
      limit: 2,
      after: result.pageInfo.endCursor,
    });
    expect(next.nodes.map((d) => d._id)).toEqual(["3", "2"]);
  });

  it("intersects the cursor predicate with a base filter", async () => {
    const mixed = [
      { _id: "1", kind: "x" },
      { _id: "2", kind: "y" },
      { _id: "3", kind: "x" },
      { _id: "4", kind: "x" },
    ];
    const result = await paginate({
      executor: makeExecutor(mixed),
      limit: 10,
      baseFilter: { kind: "x" },
    });
    expect(result.nodes.map((d) => d._id)).toEqual(["1", "3", "4"]);
  });

  it("handles an empty result set", async () => {
    const result = await paginate({ executor: makeExecutor([]), limit: 5 });
    expect(result.nodes).toEqual([]);
    expect(result.pageInfo).toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    });
  });

  it("awaits an async executor", async () => {
    const executor = jest.fn(async (query) => makeExecutor(docs)(query));
    const result = await paginate({ executor, limit: 2 });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0].limit).toBe(3); // limit + 1 over-fetch
    expect(result.nodes.map((d) => d._id)).toEqual(["1", "2"]);
  });
});

describe("default export", () => {
  it("exposes every named helper", () => {
    expect(cursorPagination).toEqual({
      encodeCursor,
      decodeCursor,
      buildCursorFromDoc,
      buildCursorFilter,
      buildSort,
      paginate,
    });
  });
});
