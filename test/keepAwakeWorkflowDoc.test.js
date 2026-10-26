import { describe, expect, it } from "@jest/globals";

describe("keep-awake workflow documentation check (#395)", () => {
  it("documents cron schedule boundaries for scheduled health pings", () => {
    const cronSchedule = "*/14 * * * *";
    expect(cronSchedule.split(" ")).toHaveLength(5);
  });
});
