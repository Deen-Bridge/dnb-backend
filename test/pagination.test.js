import { parsePagination, buildPageMeta } from "../src/utils/pagination.js";

describe("parsePagination", () => {
  it("uses defaults when nothing is provided", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("clamps an over-large limit to maxLimit", () => {
    expect(parsePagination({ limit: "1000000" }).limit).toBe(100);
    expect(parsePagination({ limit: "500" }, { maxLimit: 50 }).limit).toBe(50);
  });

  it("falls back for zero, negative and non-numeric values", () => {
    expect(parsePagination({ limit: "0" }).limit).toBe(20);
    expect(parsePagination({ limit: "-5", page: "-2" })).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(parsePagination({ limit: "abc", page: "xyz" })).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("computes skip from page and clamped limit", () => {
    expect(parsePagination({ page: "3", limit: "999" })).toEqual({ page: 3, limit: 100, skip: 200 });
  });
});

describe("buildPageMeta", () => {
  it("builds metadata", () => {
    expect(buildPageMeta(45, 2, 20)).toEqual({ page: 2, limit: 20, total: 45, pages: 3 });
    expect(buildPageMeta(undefined, 1, 20).pages).toBe(0);
  });
});
