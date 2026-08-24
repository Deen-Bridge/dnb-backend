import {
  round,
  computeCompletionRate,
  computeConversionRate,
  sumRevenue,
  computeEngagement,
  computeDropOff,
  escapeCsvCell,
  buildCsv,
  analyticsToCsv,
} from "../src/utils/analyticsCalculator.js";

describe("analyticsCalculator", () => {
  describe("round", () => {
    it("rounds to two decimals and guards non-finite input", () => {
      expect(round(1.23456)).toBe(1.23);
      expect(round(Number.NaN)).toBe(0);
      expect(round(1.23456, 3)).toBe(1.235);
    });
  });

  describe("computeCompletionRate", () => {
    it("returns percentage of completions over enrollments", () => {
      expect(computeCompletionRate(5, 20)).toBe(25);
    });
    it("returns 0 when there are no enrollments", () => {
      expect(computeCompletionRate(5, 0)).toBe(0);
    });
  });

  describe("computeConversionRate", () => {
    it("returns percentage of enrollments over views", () => {
      expect(computeConversionRate(10, 200)).toBe(5);
    });
    it("returns 0 when there are no views", () => {
      expect(computeConversionRate(10, 0)).toBe(0);
    });
  });

  describe("sumRevenue", () => {
    it("groups revenue by currency and counts transactions", () => {
      const result = sumRevenue([
        { amount: "10.5", currency: "USDC" },
        { amount: "4.5", currency: "USDC" },
        { amount: "2", currency: "XLM" },
        { amount: "not-a-number", currency: "USDC" },
      ]);
      expect(result.revenueByCurrency.USDC).toBe(15);
      expect(result.revenueByCurrency.XLM).toBe(2);
      expect(result.transactionCount).toBe(4);
      expect(result.grossByCurrency).toEqual([
        { currency: "USDC", amount: 15 },
        { currency: "XLM", amount: 2 },
      ]);
    });
  });

  describe("computeEngagement", () => {
    it("averages progress and counts active learners since a date", () => {
      const since = new Date("2026-01-10");
      const result = computeEngagement(
        [
          {
            percentComplete: 100,
            lessonsCompleted: [1, 2, 3],
            updatedAt: "2026-01-15",
          },
          {
            percentComplete: 50,
            lessonsCompleted: [1],
            updatedAt: "2026-01-05",
          },
        ],
        since
      );
      expect(result.learnersStarted).toBe(2);
      expect(result.avgPercentComplete).toBe(75);
      expect(result.avgLessonsCompleted).toBe(2);
      expect(result.activeLearners).toBe(1);
    });

    it("returns zeros for an empty cohort", () => {
      expect(computeEngagement([])).toEqual({
        learnersStarted: 0,
        avgPercentComplete: 0,
        avgLessonsCompleted: 0,
        activeLearners: 0,
      });
    });
  });

  describe("computeDropOff", () => {
    it("computes per-lesson reach and biggest drop-off point", () => {
      const lessons = [
        { lessonId: "a", title: "Intro" },
        { lessonId: "b", title: "Middle" },
        { lessonId: "c", title: "End" },
      ];
      const progress = [
        { lessonsCompleted: ["a", "b", "c"] },
        { lessonsCompleted: ["a", "b"] },
        { lessonsCompleted: ["a"] },
        { lessonsCompleted: ["a"] },
      ];
      const { lessons: rows, biggestDropOff } = computeDropOff(lessons, progress);
      expect(rows[0].reached).toBe(4);
      expect(rows[1].reached).toBe(2);
      expect(rows[2].reached).toBe(1);
      expect(rows[1].dropOff).toBe(2);
      expect(biggestDropOff.lessonId).toBe("b");
    });
  });

  describe("CSV helpers", () => {
    it("escapes cells containing commas, quotes and newlines", () => {
      expect(escapeCsvCell("plain")).toBe("plain");
      expect(escapeCsvCell("a,b")).toBe('"a,b"');
      expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    });

    it("builds a CSV document with a header row", () => {
      const csv = buildCsv(["metric", "value"], [["views", 3]]);
      expect(csv).toBe("metric,value\r\nviews,3\r\n");
    });

    it("serialises an analytics object into metric/value rows", () => {
      const csv = analyticsToCsv({
        courseId: "abc",
        title: "Test Course",
        range: { startDate: null, endDate: null },
        metrics: {
          views: 100,
          enrollmentsTotal: 10,
          enrollments: 10,
          completions: 4,
          completionRate: 40,
          conversionRate: 10,
          engagement: {
            learnersStarted: 8,
            activeLearners: 5,
            avgPercentComplete: 55,
            avgLessonsCompleted: 3,
          },
          revenue: {
            transactionCount: 2,
            grossByCurrency: [{ currency: "USDC", amount: 25 }],
          },
          dropOff: { lessons: [] },
        },
      });
      expect(csv).toContain("Course ID,abc");
      expect(csv).toContain("Revenue (USDC),25");
      expect(csv).toContain("Completion Rate (%),40");
    });
  });
});
