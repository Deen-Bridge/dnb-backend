import { jest } from "@jest/globals";

const mockAggregate = jest.fn();
const mockCreate = jest.fn();

jest.unstable_mockModule("../src/models/NotificationEvent.js", () => ({
  default: { aggregate: mockAggregate, create: mockCreate },
}));
jest.unstable_mockModule("../src/config/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { getMetrics, metricsToCsv, recordEvent } = await import(
  "../src/services/notificationAnalytics.service.js"
);

const row = (type, channel, event, count) => ({ _id: { type, channel, event }, count });

describe("notification analytics", () => {
  beforeEach(() => jest.clearAllMocks());

  it("computes open rate and CTR per type/channel", async () => {
    mockAggregate.mockResolvedValue([
      row("follow", "in_app", "sent", 100),
      row("follow", "in_app", "delivered", 80),
      row("follow", "in_app", "opened", 40),
      row("follow", "in_app", "clicked", 8),
      row("system", "email", "sent", 10),
      row("system", "email", "opened", 5),
    ]);
    const out = await getMetrics({ from: "2026-01-01", to: "2026-02-01" });
    const follow = out.find((m) => m.type === "follow");
    expect(follow).toMatchObject({ sent: 100, openRate: 0.5, clickThroughRate: 0.1 });
    const sys = out.find((m) => m.type === "system");
    expect(sys).toMatchObject({ delivered: 0, openRate: 0.5, clickThroughRate: 0 });
    const match = mockAggregate.mock.calls[0][0][0].$match;
    expect(match.timestamp.$gte).toEqual(new Date("2026-01-01"));
    expect(match.timestamp.$lte).toEqual(new Date("2026-02-01"));
  });

  it("returns zero rates without dividing by zero", async () => {
    mockAggregate.mockResolvedValue([row("bulk", "push", "opened", 3)]);
    const [m] = await getMetrics();
    expect(m.openRate).toBe(0);
  });

  it("exports CSV with header and escaping", () => {
    const csv = metricsToCsv([
      { type: "a,b", channel: "in_app", sent: 1, delivered: 1, opened: 1, clicked: 0, openRate: 1, clickThroughRate: 0 },
    ]);
    expect(csv.split("\n")[0]).toMatch(/^type,channel,sent/);
    expect(csv.split("\n")[1].startsWith('"a,b",in_app')).toBe(true);
  });

  it("recordEvent swallows DB errors", async () => {
    mockCreate.mockRejectedValue(new Error("db"));
    await expect(recordEvent({ event: "sent" })).resolves.toBeNull();
  });
});
