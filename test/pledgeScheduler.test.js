import { jest } from "@jest/globals";
import Pledge from "../src/models/Pledge.js";
import PledgeCycle from "../src/models/PledgeCycle.js";
import { computeNextDueAt, processDuePledges } from "../src/workers/pledgeScheduler.js";
import { setupMongo, teardownMongo } from "./setupMongo.js";

describe("Recurring pledge scheduler", () => {
  beforeAll(async () => {
    await setupMongo();
  });

  afterAll(async () => {
    await teardownMongo();
  });

  beforeEach(async () => {
    await Pledge.deleteMany({});
    await PledgeCycle.deleteMany({});
  });

  it("advances monthly due dates correctly for month-end anchors", () => {
    const base = new Date("2024-01-31T12:00:00.000Z");
    const next = computeNextDueAt(base, "monthly", 31);

    expect(next.getUTCFullYear()).toBe(2024);
    expect(next.getUTCMonth()).toBe(1);
    expect(next.getUTCDate()).toBe(28);
  });

  it("creates exactly one cycle when concurrent ticks run", async () => {
    const pledge = await Pledge.create({
      user: "64f1b1f1c0f1c0f1c0f1c0f1",
      publicKey: "GBD3EXD7Z4X6X6X6X6X6X6X6X6X6X6X6X6X6X6",
      amount: "5",
      cadence: "weekly",
      anchorDay: 5,
      status: "active",
      nextDueAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    await Promise.all([processDuePledges(), processDuePledges()]);

    const cycles = await PledgeCycle.find({ pledge: pledge._id }).lean();
    expect(cycles).toHaveLength(1);
    expect(cycles[0].status).toBe("due");
  });
});
