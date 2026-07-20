import request from "supertest";
import app from "../app.js";
import {
  calculateFeeSplit,
  buildSep7Uri,
  USDC_ISSUER,
} from "../src/services/stellar/stellarService.js";
import {
  paymentsInitialized,
  paymentsSubmitted,
  paymentsConfirmed,
  paymentsFailed,
} from "../src/config/metrics.js";

describe("DeenBridge API", () => {
  it("should respond to GET / with welcome message", async () => {
    const res = await request(app).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Welcome to DeenBridge API");
  });

  it("should respond to GET /health", async () => {
    const res = await request(app).get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("success", true);
  });

  it("should respond to GET /api/courses", async () => {
    const res = await request(app).get("/api/courses");
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("success");
  });

  it("should respond to GET /api/spaces", async () => {
    const res = await request(app).get("/api/spaces");
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("success");
  });
});

describe("Request ID propagation", () => {
  it("should return X-Request-Id header on every response", async () => {
    const res = await request(app).get("/");
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("should honor incoming X-Request-Id header", async () => {
    const customId = "my-test-request-id-123";
    const res = await request(app)
      .get("/health")
      .set("X-Request-Id", customId);
    expect(res.headers["x-request-id"]).toBe(customId);
  });
});

describe("Metrics endpoint", () => {
  it("should return Prometheus text format when no token is configured", async () => {
    const tokenBefore = process.env.METRICS_TOKEN;
    delete process.env.METRICS_TOKEN;

    const res = await request(app).get("/metrics");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.text).toContain("http_request_duration_seconds");
    expect(res.text).toContain("payments_initialized_total");
    expect(res.text).toContain("payments_submitted_total");
    expect(res.text).toContain("payments_confirmed_total");
    expect(res.text).toContain("payments_failed_total");
    expect(res.text).toContain("horizon_request_duration_seconds");

    if (tokenBefore !== undefined) {
      process.env.METRICS_TOKEN = tokenBefore;
    }
  });

  it("should require Bearer token when METRICS_TOKEN is set", async () => {
    process.env.METRICS_TOKEN = "secret-token-456";

    const resNoAuth = await request(app).get("/metrics");
    expect(resNoAuth.statusCode).toBe(401);

    const resAuth = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer secret-token-456");
    expect(resAuth.statusCode).toBe(200);

    delete process.env.METRICS_TOKEN;
  });
});

describe("Funnel counter increments", () => {
  beforeEach(() => {
    paymentsInitialized.reset({ type: "purchase" });
    paymentsInitialized.reset({ type: "donation" });
    paymentsSubmitted.reset({ type: "purchase" });
    paymentsSubmitted.reset({ type: "donation" });
    paymentsConfirmed.reset({ type: "purchase" });
    paymentsConfirmed.reset({ type: "donation" });
    paymentsFailed.reset({ type: "purchase" });
    paymentsFailed.reset({ type: "donation" });
  });

  it("purchase funnel counters increment correctly", () => {
    paymentsInitialized.inc({ type: "purchase" });
    paymentsSubmitted.inc({ type: "purchase" });
    paymentsConfirmed.inc({ type: "purchase" });

    const init = paymentsInitialized.hashMap.get(
      JSON.stringify({ type: "purchase" })
    );
    const sub = paymentsSubmitted.hashMap.get(
      JSON.stringify({ type: "purchase" })
    );
    const conf = paymentsConfirmed.hashMap.get(
      JSON.stringify({ type: "purchase" })
    );

    expect(init?.values[0].value).toBe(1);
    expect(sub?.values[0].value).toBe(1);
    expect(conf?.values[0].value).toBe(1);
  });

  it("donation funnel counters increment correctly", () => {
    paymentsInitialized.inc({ type: "donation" });
    paymentsSubmitted.inc({ type: "donation" });
    paymentsConfirmed.inc({ type: "donation" });

    const init = paymentsInitialized.hashMap.get(
      JSON.stringify({ type: "donation" })
    );
    const sub = paymentsSubmitted.hashMap.get(
      JSON.stringify({ type: "donation" })
    );
    const conf = paymentsConfirmed.hashMap.get(
      JSON.stringify({ type: "donation" })
    );

    expect(init?.values[0].value).toBe(1);
    expect(sub?.values[0].value).toBe(1);
    expect(conf?.values[0].value).toBe(1);
  });

  it("failed counter increments with reason label", () => {
    paymentsFailed.inc({ type: "purchase", reason: "stellar_error" });

    const fail = paymentsFailed.hashMap.get(
      JSON.stringify({ type: "purchase", reason: "stellar_error" })
    );
    expect(fail?.values[0].value).toBe(1);
  });
});

describe("Stellar donations", () => {
  it("should respond to GET /api/stellar/donation/stats (503 when donation wallet is not configured)", async () => {
    const res = await request(app).get("/api/stellar/donation/stats");

    if (process.env.DONATION_WALLET_PUBLIC_KEY) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("poolBalance");
      expect(res.body).toHaveProperty("donationCount");
      expect(res.body).toHaveProperty("totalDonated");
      expect(Array.isArray(res.body.recent)).toBe(true);
    } else {
      expect(res.statusCode).toBe(503);
      expect(res.body).toHaveProperty("success", false);
    }
  });

  it("should require auth for POST /api/stellar/donation/initialize", async () => {
    const res = await request(app)
      .post("/api/stellar/donation/initialize")
      .send({ amount: "10", publicKey: "GABC" });
    expect(res.statusCode).toBe(401);
  });

  it("should require auth for POST /api/stellar/donation/submit", async () => {
    const res = await request(app)
      .post("/api/stellar/donation/submit")
      .send({ donationId: "x", signedXdr: "y" });
    expect(res.statusCode).toBe(401);
  });
});

describe("Stellar service (unit, no network)", () => {
  const PLATFORM_WALLET =
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  describe("calculateFeeSplit", () => {
    it("splits an amount between creator and platform", () => {
      const split = calculateFeeSplit("10", 5, PLATFORM_WALLET);
      expect(split).not.toBeNull();
      expect(split.creatorAmount).toBe("9.5");
      expect(split.platformAmount).toBe("0.5");
      expect(split.platformWallet).toBe(PLATFORM_WALLET);
    });

    it("handles fractional fee percents with 7-decimal precision", () => {
      const split = calculateFeeSplit("10", 2.5, PLATFORM_WALLET);
      expect(split.creatorAmount).toBe("9.75");
      expect(split.platformAmount).toBe("0.25");
    });

    it("gives the rounding remainder to the creator and sums exactly", () => {
      const split = calculateFeeSplit("9.9999999", 3, PLATFORM_WALLET);
      expect(split.platformAmount).toBe("0.2999999");
      expect(split.creatorAmount).toBe("9.7");

      const toStroops = (a) => {
        const [whole, frac = ""] = a.split(".");
        return (
          BigInt(whole) * 10000000n + BigInt((frac + "0000000").slice(0, 7))
        );
      };
      expect(
        toStroops(split.creatorAmount) + toStroops(split.platformAmount)
      ).toBe(toStroops("9.9999999"));
    });

    it("returns null when no fee percent is configured", () => {
      expect(calculateFeeSplit("10", 0, PLATFORM_WALLET)).toBeNull();
    });

    it("returns null when no platform wallet is configured", () => {
      expect(calculateFeeSplit("10", 5, "")).toBeNull();
    });

    it("returns null when the fee rounds down to zero stroops", () => {
      expect(calculateFeeSplit("0.0000001", 5, PLATFORM_WALLET)).toBeNull();
    });
  });

  describe("buildSep7Uri", () => {
    it("builds a web+stellar:pay URI with USDC asset params", () => {
      const uri = buildSep7Uri({
        destination: PLATFORM_WALLET,
        amount: "25",
      });
      expect(uri.startsWith("web+stellar:pay?")).toBe(true);

      const params = new URLSearchParams(uri.split("?")[1]);
      expect(params.get("destination")).toBe(PLATFORM_WALLET);
      expect(params.get("amount")).toBe("25");
      expect(params.get("asset_code")).toBe("USDC");
      expect(params.get("asset_issuer")).toBe(USDC_ISSUER);
      expect(params.get("memo")).toBeNull();
      expect(params.get("memo_type")).toBeNull();
    });

    it("includes memo and memo_type only when a memo is provided", () => {
      const uri = buildSep7Uri({
        destination: PLATFORM_WALLET,
        amount: "1.5",
        memo: "DNB-SADAQAH",
      });

      const params = new URLSearchParams(uri.split("?")[1]);
      expect(params.get("memo")).toBe("DNB-SADAQAH");
      expect(params.get("memo_type")).toBe("MEMO_TEXT");
    });
  });
});
