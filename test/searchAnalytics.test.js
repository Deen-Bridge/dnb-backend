import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCreate = jest.fn();
const mockAggregate = jest.fn();

const SearchAnalyticsEvent = {
  create: mockCreate,
  aggregate: mockAggregate,
};

jest.unstable_mockModule("../src/models/search-analytics-event.js", () => ({
  default: SearchAnalyticsEvent,
}));

jest.unstable_mockModule("../src/config/logger.js", () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule("../src/middlewares/authMiddleware.js", () => ({
  protect: (req, _res, next) => {
    req.user = {
      _id: new mongoose.Types.ObjectId(),
      role: "admin",
    };
    next();
  },
  authorizeRoles:
    (...roles) =>
    (req, _res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return _res
          .status(403)
          .json({ success: false, message: "Forbidden" });
      }
      next();
    },
}));

// ── Import routes after mocks ─────────────────────────────────────────────────

const searchAnalyticsRoutes = (
  await import("../src/routes/analytics/search.js")
).default;

const mount = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/analytics/search", searchAnalyticsRoutes);
  return app;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Issue #245 — Search Analytics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/analytics/search/top (getTopSearchQueriesHandler)", () => {
    it("returns 200 with top search queries", async () => {
      mockAggregate
        .mockResolvedValueOnce([
          { query: "react tutorial", count: 150, lastSearched: new Date(), uniqueUsers: 80 },
          { query: "javascript basics", count: 120, lastSearched: new Date(), uniqueUsers: 65 },
        ])
        .mockResolvedValueOnce([{ total: 2 }]);

      const res = await request(mount()).get("/api/analytics/search/top");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].query).toBe("react tutorial");
      expect(res.body.data[0].count).toBe(150);
      expect(res.body.pagination).toBeDefined();
    });

    it("returns 200 with empty array when no searches exist", async () => {
      mockAggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

      const res = await request(mount()).get("/api/analytics/search/top");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("supports date range filtering", async () => {
      mockAggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

      const res = await request(mount()).get(
        "/api/analytics/search/top?startDate=2026-01-01&endDate=2026-12-31"
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("supports type filtering", async () => {
      mockAggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

      const res = await request(mount()).get("/api/analytics/search/top?type=courses");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /api/analytics/search/zero-results (getZeroResultSearchesHandler)", () => {
    it("returns 200 with zero-result queries", async () => {
      mockAggregate
        .mockResolvedValueOnce([
          { query: "nonexistent topic", count: 25, lastSearched: new Date() },
        ])
        .mockResolvedValueOnce([{ total: 1 }]);

      const res = await request(mount()).get("/api/analytics/search/zero-results");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].query).toBe("nonexistent topic");
      expect(res.body.data[0].count).toBe(25);
    });

    it("returns 200 with empty array when no zero-result searches", async () => {
      mockAggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

      const res = await request(mount()).get("/api/analytics/search/zero-results");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("GET /api/analytics/search/summary (getSearchSummaryHandler)", () => {
    it("returns 200 with search summary metrics", async () => {
      mockAggregate.mockResolvedValue([
        {
          totalSearches: 1000,
          uniqueQueries: 250,
          uniqueUsers: 150,
          zeroResultSearches: 50,
          searchesWithResults: 950,
          zeroResultRate: 5.0,
        },
      ]);

      const res = await request(mount()).get("/api/analytics/search/summary");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalSearches).toBe(1000);
      expect(res.body.data.uniqueQueries).toBe(250);
      expect(res.body.data.zeroResultRate).toBe(5.0);
    });

    it("returns default summary when no events exist", async () => {
      mockAggregate.mockResolvedValue([]);

      const res = await request(mount()).get("/api/analytics/search/summary");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalSearches).toBe(0);
      expect(res.body.data.zeroResultRate).toBe(0);
    });
  });

  describe("GET /api/analytics/search/trends (getSearchTrendsHandler)", () => {
    it("returns 200 with search trends over time", async () => {
      mockAggregate.mockResolvedValue([
        { _id: "2026-08-01", total: 50, withResults: 45, zeroResults: 5 },
        { _id: "2026-08-02", total: 60, withResults: 55, zeroResults: 5 },
      ]);

      const res = await request(mount()).get("/api/analytics/search/trends");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]._id).toBe("2026-08-01");
      expect(res.body.data[0].total).toBe(50);
    });

    it("returns empty trends when no events exist", async () => {
      mockAggregate.mockResolvedValue([]);

      const res = await request(mount()).get("/api/analytics/search/trends");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("Authentication", () => {
    it("routes are mounted and respond (auth is enforced by protect + authorizeRoles middleware)", async () => {
      // The protect and authorizeRoles middlewares are mocked to always pass.
      // In production, authorizeRoles("admin") blocks non-admin users.
      // This test verifies the routes exist and respond.
      mockAggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);
      const res = await request(mount()).get("/api/analytics/search/top");
      expect(res.status).not.toBe(404);
      expect(res.body.success).toBe(true);
    });
  });

  describe("Response envelope consistency", () => {
    it("all endpoints return success boolean and data key", async () => {
      mockAggregate.mockResolvedValue([]);
      mockAggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

      const app = mount();

      const topRes = await request(app).get("/api/analytics/search/top");
      expect(typeof topRes.body.success).toBe("boolean");
      expect("data" in topRes.body).toBe(true);

      mockAggregate.mockResolvedValue([]);
      mockAggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);

      const zeroRes = await request(app).get("/api/analytics/search/zero-results");
      expect(typeof zeroRes.body.success).toBe("boolean");
      expect("data" in zeroRes.body).toBe(true);

      mockAggregate.mockResolvedValue([]);
      const summaryRes = await request(app).get("/api/analytics/search/summary");
      expect(typeof summaryRes.body.success).toBe("boolean");
      expect("data" in summaryRes.body).toBe(true);

      mockAggregate.mockResolvedValue([]);
      const trendsRes = await request(app).get("/api/analytics/search/trends");
      expect(typeof trendsRes.body.success).toBe("boolean");
      expect("data" in trendsRes.body).toBe(true);
    });
  });
});
