import { BODY_LIMITS } from "../src/middlewares/bodyBudgets.js";

describe("request body budgets", () => {
  it("keeps the default parsers below the former global 10 MB budget", () => {
    expect(BODY_LIMITS.defaultJson).toBe("100kb");
    expect(BODY_LIMITS.defaultUrlencoded).toBe("100kb");
  });

  it("allows only documented larger payload classes to opt in", () => {
    expect(BODY_LIMITS.cspReport).toBe("10kb");
    expect(BODY_LIMITS.analyticsEvent).toBe("256kb");
    expect(BODY_LIMITS.providerWebhook).toBe("256kb");
    expect(BODY_LIMITS.serviceRequest).toBe("1mb");
  });
});
