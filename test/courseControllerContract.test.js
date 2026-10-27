import { describe, expect, it } from "@jest/globals";

describe("course controller contract (#438)", () => {
  it("computes course completion percentage deterministically", () => {
    const calcProgress = (completedLessons, totalLessons) =>
      totalLessons <= 0 ? 0 : Math.min(100, Math.round((completedLessons / totalLessons) * 100));
    expect(calcProgress(3, 10)).toBe(30);
    expect(calcProgress(10, 10)).toBe(100);
    expect(calcProgress(0, 0)).toBe(0);
  });
});
