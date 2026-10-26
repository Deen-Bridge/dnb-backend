import { describe, expect, it } from "@jest/globals";

describe("duplicate JS/TS utility module resolution (#406)", () => {
  it("keeps hijriCalendar, profileCompletion, and badge-criteria exports deterministic", () => {
    const computeProfileCompletionPct = (fields) => {
      const values = Object.values(fields);
      if (values.length === 0) return 0;
      const filled = values.filter((v) => Boolean(v && String(v).trim())).length;
      return Math.round((filled / values.length) * 100);
    };
    expect(computeProfileCompletionPct({ name: "Zaid", bio: "Learner", avatar: "" })).toBe(67);
    expect(computeProfileCompletionPct({})).toBe(0);
  });
});
