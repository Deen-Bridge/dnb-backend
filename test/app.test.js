import request from "supertest";
import app from "../app.js";
import {
  calculateFeeSplit,
  buildSep7Uri,
  USDC_ISSUER,
} from "../src/services/stellar/stellarService.js";

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

});

describe("Stellar donations", () => {
  it("should respond to GET /api/stellar/donation/stats (503 when donation wallet is not configured)", async () => {
    const res = await request(app).get("/api/stellar/donation/stats");

    if (process.env.DONATION_WALLET_PUBLIC_KEY && res.statusCode === 200) {
      // Wallet configured: shaped stats response
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("poolBalance");
      expect(res.body).toHaveProperty("donationCount");
      expect(res.body).toHaveProperty("totalDonated");
      expect(Array.isArray(res.body.recent)).toBe(true);
    } else {
      expect([503, 500]).toContain(res.statusCode);
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
      // 9.9999999 USDC = 99,999,999 stroops; 3% = 2,999,999.97 stroops -> floor
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
      // 0.0000001 USDC at 5% = 0.05 stroops -> floor to 0, no valid payment op
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
