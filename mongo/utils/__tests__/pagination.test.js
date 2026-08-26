import { jest } from "@jest/globals";
import paginationHelper, {
  resolveLimit,
  formatPaginationMeta,
  formatPaginationResponse,
  paginateOffset,
  paginateCursor,
  paginate,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from "../pagination.js";
import { encodeCursor } from "../cursorPagination.js";

/**
 * Mock database collection helper for memory testing.
 */
const createMockCollection = (docs = []) => {
  const executor = async ({ filter, sort, limit, skip = 0 }) => {
    let result = docs.filter((doc) => matchesFilter(doc, filter));
    if (sort) {
      const [[field, dir]] = Object.entries(sort);
      result = [...result].sort((a, b) => {
        if (a[field] < b[field]) return -1 * dir;
        if (a[field] > b[field]) return 1 * dir;
        return 0;
      });
    }
    return result.slice(skip, skip + limit);
  };

  const countExecutor = async ({ filter }) => {
    return docs.filter((doc) => matchesFilter(doc, filter)).length;
  };

  return { executor, countExecutor };
};

const matchesFilter = (doc, filter) => {
  if (!filter || Object.keys(filter).length === 0) return true;
  if (filter.$and) return filter.$and.every((f) => matchesFilter(doc, f));
  if (filter.$or) return filter.$or.some((f) => matchesFilter(doc, f));
  return Object.entries(filter).every(([key, cond]) => {
    const val = doc[key];
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, operand]) => {
        if (op === "$gt") return val > operand;
        if (op === "$lt") return val < operand;
        if (op === "$gte") return val >= operand;
        if (op === "$lte") return val <= operand;
        return false;
      });
    }
    return val === cond;
  });
};

describe("pagination helper - resolveLimit", () => {
  it("uses DEFAULT_LIMIT when limit is omitted or invalid", () => {
    expect(resolveLimit()).toBe(DEFAULT_LIMIT);
    expect(resolveLimit(null)).toBe(DEFAULT_LIMIT);
    expect(resolveLimit("invalid")).toBe(DEFAULT_LIMIT);
    expect(resolveLimit(-5)).toBe(DEFAULT_LIMIT);
  });

  it("clamps limit up to MAX_LIMIT", () => {
    expect(resolveLimit(150)).toBe(MAX_LIMIT);
    expect(resolveLimit(50)).toBe(50);
    expect(resolveLimit(1)).toBe(1);
  });
});

describe("pagination helper - formatPaginationMeta / formatPaginationResponse", () => {
  it("formats metadata with correct defaults", () => {
    const meta = formatPaginationMeta({ limit: 10, hasNext: true });
    expect(meta).toEqual({
      total: null,
      page: null,
      limit: 10,
      totalPages: null,
      offset: null,
      hasNext: true,
      hasPrevious: false,
      startCursor: null,
      endCursor: null,
      nextCursor: null,
      prevCursor: null,
    });
  });

  it("builds response object with meta and top-level aliases", () => {
    const res = formatPaginationResponse([{ _id: "1" }], {
      total: 100,
      page: 2,
      limit: 10,
      totalPages: 10,
      offset: 10,
      hasNext: true,
      hasPrevious: true,
    });

    expect(res.data).toEqual([{ _id: "1" }]);
    expect(res.total).toBe(100);
    expect(res.page).toBe(2);
    expect(res.limit).toBe(10);
    expect(res.totalPages).toBe(10);
    expect(res.offset).toBe(10);
    expect(res.hasNext).toBe(true);
    expect(res.hasPrevious).toBe(true);
    expect(res.hasNextPage).toBe(true);
    expect(res.hasPrevPage).toBe(true);
    expect(res.meta.total).toBe(100);
  });
});

describe("pagination helper - paginateOffset", () => {
  const sampleDocs = Array.from({ length: 25 }, (_, i) => ({
    _id: String(i + 1).padStart(2, "0"),
    val: i + 1,
  }));

  it("throws TypeError if executor is missing", async () => {
    await expect(paginateOffset()).rejects.toThrow(TypeError);
  });

  it("paginates page 1 of sample data with ascending order", async () => {
    const { executor, countExecutor } = createMockCollection(sampleDocs);
    const result = await paginateOffset({
      executor,
      countExecutor,
      page: 1,
      limit: 10,
      order: "asc",
    });

    expect(result.data).toHaveLength(10);
    expect(result.data[0]._id).toBe("01");
    expect(result.total).toBe(25);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(3);
    expect(result.offset).toBe(0);
    expect(result.hasNext).toBe(true);
    expect(result.hasPrevious).toBe(false);
  });

  it("paginates last page correctly with ascending order", async () => {
    const { executor, countExecutor } = createMockCollection(sampleDocs);
    const result = await paginateOffset({
      executor,
      countExecutor,
      page: 3,
      limit: 10,
      order: "asc",
    });

    expect(result.data).toHaveLength(5);
    expect(result.data[0]._id).toBe("21");
    expect(result.page).toBe(3);
    expect(result.hasNext).toBe(false);
    expect(result.hasPrevious).toBe(true);
  });

  it("supports explicit offset override", async () => {
    const { executor, countExecutor } = createMockCollection(sampleDocs);
    const result = await paginateOffset({
      executor,
      countExecutor,
      offset: 15,
      limit: 5,
      order: "asc",
    });

    expect(result.data[0]._id).toBe("16");
    expect(result.offset).toBe(15);
  });

  it("uses precomputed total when provided", async () => {
    const executor = jest.fn(async () => sampleDocs.slice(0, 5));
    const countExecutor = jest.fn();

    const result = await paginateOffset({
      executor,
      countExecutor,
      total: 50,
      limit: 5,
    });

    expect(result.total).toBe(50);
    expect(result.totalPages).toBe(10);
    expect(countExecutor).not.toHaveBeenCalled();
  });
});

describe("pagination helper - paginateCursor", () => {
  const sampleDocs = Array.from({ length: 15 }, (_, i) => ({
    _id: String(i + 1).padStart(2, "0"),
    name: `Item ${i + 1}`,
  }));

  it("throws TypeError if executor is missing", async () => {
    await expect(paginateCursor()).rejects.toThrow(TypeError);
  });

  it("paginates first page with cursor metadata", async () => {
    const { executor } = createMockCollection(sampleDocs);
    const result = await paginateCursor({
      executor,
      sortField: "_id",
      sortOrder: 1,
      limit: 5,
    });

    expect(result.data).toHaveLength(5);
    expect(result.data[0]._id).toBe("01");
    expect(result.hasNext).toBe(true);
    expect(result.hasPrevious).toBe(false);
    expect(result.startCursor).toBeDefined();
    expect(result.endCursor).toBeDefined();
    expect(result.nextCursor).toBe(result.endCursor);
  });

  it("walks to second page using cursor / after", async () => {
    const { executor } = createMockCollection(sampleDocs);
    const page1 = await paginateCursor({
      executor,
      sortField: "_id",
      sortOrder: 1,
      limit: 5,
    });

    const page2 = await paginateCursor({
      executor,
      sortField: "_id",
      sortOrder: 1,
      limit: 5,
      after: page1.nextCursor,
    });

    expect(page2.data).toHaveLength(5);
    expect(page2.data[0]._id).toBe("06");
    expect(page2.hasPrevious).toBe(true);
  });

  it("includes total count when includeTotal is true", async () => {
    const { executor, countExecutor } = createMockCollection(sampleDocs);
    const result = await paginateCursor({
      executor,
      countExecutor,
      includeTotal: true,
      limit: 5,
    });

    expect(result.total).toBe(15);
  });
});

describe("pagination helper - master paginate function", () => {
  const sampleDocs = Array.from({ length: 10 }, (_, i) => ({
    _id: String(i + 1).padStart(2, "0"),
  }));

  it("defaults to offset mode when cursor is not provided", async () => {
    const { executor, countExecutor } = createMockCollection(sampleDocs);
    const result = await paginate({
      executor,
      countExecutor,
      page: 1,
      limit: 5,
    });

    expect(result.page).toBe(1);
    expect(result.total).toBe(10);
  });

  it("auto-selects cursor mode when cursor/after parameter is provided", async () => {
    const { executor } = createMockCollection(sampleDocs);
    const firstCursor = encodeCursor({ id: "02" });

    const result = await paginate({
      executor,
      cursor: firstCursor,
      limit: 5,
    });

    expect(result.startCursor).toBeDefined();
    expect(result.data[0]._id).toBe("03");
  });

  it("respects explicit mode override", async () => {
    const { executor, countExecutor } = createMockCollection(sampleDocs);
    const result = await paginate({
      executor,
      countExecutor,
      mode: "offset",
      cursor: "ignored_in_explicit_offset_mode",
      page: 1,
      limit: 5,
    });

    expect(result.page).toBe(1);
    expect(result.total).toBe(10);
  });
});

describe("default export", () => {
  it("exposes expected helpers", () => {
    expect(paginationHelper).toHaveProperty("paginate");
    expect(paginationHelper).toHaveProperty("paginateOffset");
    expect(paginationHelper).toHaveProperty("paginateCursor");
    expect(paginationHelper).toHaveProperty("formatPaginationResponse");
    expect(paginationHelper).toHaveProperty("formatPaginationMeta");
    expect(paginationHelper).toHaveProperty("resolveLimit");
  });
});
