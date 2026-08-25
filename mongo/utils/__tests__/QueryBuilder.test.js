/**
 * @jest-environment node
 *
 * Tests for the QueryBuilder utility (#180).
 */

import QueryBuilder, { query } from "../QueryBuilder.js";

// Mock Mongoose Model and Query
const createMockQuery = () => {
  const chainable = {
    where: jest.fn().mockReturnThis(),
    equals: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    nin: jest.fn().mockReturnThis(),
    regex: jest.fn().mockReturnThis(),
    exists: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([{ _id: "1", name: "Test" }]),
    getFilter: jest.fn().mockReturnValue({}),
    getOptions: jest.fn().mockReturnValue({}),
    getPopulatedPaths: jest.fn().mockReturnValue([]),
    clone: jest.fn(),
    model: null,
  };
  chainable.clone.mockReturnValue({ ...chainable, clone: jest.fn() });
  return chainable;
};

const createMockModel = (mockQuery) => ({
  find: jest.fn().mockReturnValue(mockQuery),
  findOne: jest.fn().mockReturnValue(mockQuery),
  countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(42) }),
  distinct: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(["a", "b"]) }),
  schema: {},
});

describe("QueryBuilder", () => {
  let mockQuery;
  let mockModel;

  beforeEach(() => {
    mockQuery = createMockQuery();
    mockModel = createMockModel(mockQuery);
    mockQuery.model = mockModel;
  });

  describe("constructor", () => {
    it("accepts a Mongoose Model", () => {
      const builder = new QueryBuilder(mockModel);
      expect(mockModel.find).toHaveBeenCalled();
    });

    it("accepts an existing Query", () => {
      const builder = new QueryBuilder(mockQuery);
      expect(builder.getQuery()).toBe(mockQuery);
    });

    it("throws on invalid input", () => {
      expect(() => new QueryBuilder(null)).toThrow(TypeError);
      expect(() => new QueryBuilder({})).toThrow(TypeError);
    });
  });

  describe("where()", () => {
    it("accepts object conditions", () => {
      const builder = new QueryBuilder(mockModel);
      builder.where({ status: "active" });
      expect(mockQuery.where).toHaveBeenCalledWith({ status: "active" });
    });

    it("accepts field and value", () => {
      const builder = new QueryBuilder(mockModel);
      builder.where("role", "educator");
      expect(mockQuery.where).toHaveBeenCalledWith("role");
      expect(mockQuery.equals).toHaveBeenCalledWith("educator");
    });

    it("returns this for chaining", () => {
      const builder = new QueryBuilder(mockModel);
      expect(builder.where({ a: 1 })).toBe(builder);
    });
  });

  describe("comparison methods", () => {
    it("gt() adds greater-than condition", () => {
      const builder = new QueryBuilder(mockModel);
      builder.gt("age", 18);
      expect(mockQuery.where).toHaveBeenCalledWith("age");
      expect(mockQuery.gt).toHaveBeenCalledWith(18);
    });

    it("gte() adds greater-than-or-equal condition", () => {
      const builder = new QueryBuilder(mockModel);
      builder.gte("age", 21);
      expect(mockQuery.gte).toHaveBeenCalledWith(21);
    });

    it("lt() adds less-than condition", () => {
      const builder = new QueryBuilder(mockModel);
      builder.lt("price", 100);
      expect(mockQuery.lt).toHaveBeenCalledWith(100);
    });

    it("lte() adds less-than-or-equal condition", () => {
      const builder = new QueryBuilder(mockModel);
      builder.lte("price", 50);
      expect(mockQuery.lte).toHaveBeenCalledWith(50);
    });
  });

  describe("in() and nin()", () => {
    it("in() adds $in condition", () => {
      const builder = new QueryBuilder(mockModel);
      builder.in("status", ["active", "pending"]);
      expect(mockQuery.in).toHaveBeenCalledWith(["active", "pending"]);
    });

    it("nin() adds $nin condition", () => {
      const builder = new QueryBuilder(mockModel);
      builder.nin("role", ["banned", "suspended"]);
      expect(mockQuery.nin).toHaveBeenCalledWith(["banned", "suspended"]);
    });
  });

  describe("regex()", () => {
    it("accepts RegExp", () => {
      const builder = new QueryBuilder(mockModel);
      const rx = /test/i;
      builder.regex("name", rx);
      expect(mockQuery.regex).toHaveBeenCalledWith(rx);
    });

    it("accepts string pattern with flags", () => {
      const builder = new QueryBuilder(mockModel);
      builder.regex("name", "test", "i");
      expect(mockQuery.regex).toHaveBeenCalledWith(expect.any(RegExp));
    });
  });

  describe("select()", () => {
    it("accepts string projection", () => {
      const builder = new QueryBuilder(mockModel);
      builder.select("name email -password");
      expect(mockQuery.select).toHaveBeenCalledWith("name email -password");
    });

    it("accepts object projection", () => {
      const builder = new QueryBuilder(mockModel);
      builder.select({ name: 1, email: 1 });
      expect(mockQuery.select).toHaveBeenCalledWith({ name: 1, email: 1 });
    });
  });

  describe("sort()", () => {
    it("accepts string sort", () => {
      const builder = new QueryBuilder(mockModel);
      builder.sort("-createdAt name");
      expect(mockQuery.sort).toHaveBeenCalledWith("-createdAt name");
    });

    it("accepts object sort", () => {
      const builder = new QueryBuilder(mockModel);
      builder.sort({ createdAt: -1 });
      expect(mockQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });
  });

  describe("limit() and skip()", () => {
    it("limit() sets result limit", () => {
      const builder = new QueryBuilder(mockModel);
      builder.limit(20);
      expect(mockQuery.limit).toHaveBeenCalledWith(20);
    });

    it("skip() sets offset", () => {
      const builder = new QueryBuilder(mockModel);
      builder.skip(40);
      expect(mockQuery.skip).toHaveBeenCalledWith(40);
    });

    it("ignores negative values", () => {
      const builder = new QueryBuilder(mockModel);
      builder.limit(-5);
      builder.skip(-10);
      expect(mockQuery.limit).not.toHaveBeenCalled();
      expect(mockQuery.skip).not.toHaveBeenCalled();
    });
  });

  describe("paginate()", () => {
    it("computes skip and limit from page number", () => {
      const builder = new QueryBuilder(mockModel);
      builder.paginate(3, 20);
      expect(mockQuery.skip).toHaveBeenCalledWith(40); // (3-1) * 20
      expect(mockQuery.limit).toHaveBeenCalledWith(20);
    });

    it("handles page 1", () => {
      const builder = new QueryBuilder(mockModel);
      builder.paginate(1, 10);
      expect(mockQuery.skip).toHaveBeenCalledWith(0);
      expect(mockQuery.limit).toHaveBeenCalledWith(10);
    });
  });

  describe("populate()", () => {
    it("accepts string path", () => {
      const builder = new QueryBuilder(mockModel);
      builder.populate("author");
      expect(mockQuery.populate).toHaveBeenCalledWith("author");
    });

    it("accepts array of paths", () => {
      const builder = new QueryBuilder(mockModel);
      builder.populate(["author", "category"]);
      expect(mockQuery.populate).toHaveBeenCalledTimes(2);
    });

    it("accepts object config", () => {
      const builder = new QueryBuilder(mockModel);
      const config = { path: "author", select: "name" };
      builder.populate(config);
      expect(mockQuery.populate).toHaveBeenCalledWith(config);
    });
  });

  describe("lean()", () => {
    it("enables lean mode by default", () => {
      const builder = new QueryBuilder(mockModel);
      builder.lean();
      expect(mockQuery.lean).toHaveBeenCalledWith(true);
    });

    it("can disable lean mode", () => {
      const builder = new QueryBuilder(mockModel);
      builder.lean(false);
      expect(mockQuery.lean).toHaveBeenCalledWith(false);
    });
  });

  describe("exec()", () => {
    it("executes the query", async () => {
      const builder = new QueryBuilder(mockModel);
      const result = await builder.exec();
      expect(mockQuery.exec).toHaveBeenCalled();
      expect(result).toEqual([{ _id: "1", name: "Test" }]);
    });
  });

  describe("count()", () => {
    it("returns document count", async () => {
      const builder = new QueryBuilder(mockModel);
      const count = await builder.count();
      expect(mockModel.countDocuments).toHaveBeenCalled();
      expect(count).toBe(42);
    });
  });

  describe("distinct()", () => {
    it("returns distinct values", async () => {
      const builder = new QueryBuilder(mockModel);
      const values = await builder.distinct("category");
      expect(mockModel.distinct).toHaveBeenCalledWith("category", {});
      expect(values).toEqual(["a", "b"]);
    });
  });

  describe("method chaining", () => {
    it("supports fluent interface", async () => {
      const builder = new QueryBuilder(mockModel);

      const result = await builder
        .where({ status: "active" })
        .where("role", "educator")
        .gt("age", 18)
        .select("name email")
        .sort("-createdAt")
        .limit(20)
        .skip(40)
        .populate("courses")
        .lean()
        .exec();

      expect(mockQuery.where).toHaveBeenCalled();
      expect(mockQuery.select).toHaveBeenCalled();
      expect(mockQuery.sort).toHaveBeenCalled();
      expect(mockQuery.limit).toHaveBeenCalled();
      expect(mockQuery.skip).toHaveBeenCalled();
      expect(mockQuery.populate).toHaveBeenCalled();
      expect(mockQuery.lean).toHaveBeenCalled();
      expect(mockQuery.exec).toHaveBeenCalled();
    });
  });

  describe("clone()", () => {
    it("creates a copy of the builder", () => {
      const builder = new QueryBuilder(mockModel);
      const cloned = builder.clone();
      expect(cloned).not.toBe(builder);
      expect(cloned).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("query() factory function", () => {
    it("creates a QueryBuilder from a model", () => {
      const builder = query(mockModel);
      expect(builder).toBeInstanceOf(QueryBuilder);
    });
  });
});
