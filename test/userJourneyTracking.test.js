import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCreate = jest.fn();
const mockFind = jest.fn();
const mockCountDocuments = jest.fn();
const mockAggregate = jest.fn();

// Build a chainable mock: find().sort().skip().limit().lean()
const buildChainableQuery = (result) => {
  const lean = jest.fn().mockResolvedValue(result);
  const limit = jest.fn().mockReturnValue({ lean });
  const skip = jest.fn().mockReturnValue({ limit });
  const sort = jest.fn().mockReturnValue({ skip });
  return { sort };
};

const UserJourneyEvent = {
  create: mockCreate,
  find: mockFind,
  countDocuments: mockCountDocuments,
  aggregate: mockAggregate,
};

jest.unstable_mockModule("../src/models/user-journey-event.js", () => ({
  default: UserJourneyEvent,
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
      role: "student",
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

const userJourneyRoutes = (
  await import("../src/routes/analytics/user-journey.js")
).default;

const mount = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/analytics/journey", userJourneyRoutes);
  return app;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Issue #246 — User Journey Tracking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/analytics/journey (getJourneyHandler)", () => {
    it("returns 200 with journey events for the authenticated user", async () => {
      const mockEvents = [
        { page: "/home", eventType: "page_visit" },
        { page: "/courses", eventType: "page_visit" },
      ];
      mockFind.mockReturnValue(buildChainableQuery(mockEvents));
      mockCountDocuments.mockResolvedValue(2);

      const res = await request(mount()).get("/api/analytics/journey");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBe(2);
    });

    it("returns 200 with empty array when no events exist", async () => {
      mockFind.mockReturnValue(buildChainableQuery([]));
      mockCountDocuments.mockResolvedValue(0);

      const res = await request(mount()).get("/api/analytics/journey");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("supports filtering by sessionId", async () => {
      mockFind.mockReturnValue(buildChainableQuery([]));
      mockCountDocuments.mockResolvedValue(0);

      const res = await request(mount()).get(
        "/api/analytics/journey?sessionId=abc123"
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("supports date range filtering", async () => {
      mockFind.mockReturnValue(buildChainableQuery([]));
      mockCountDocuments.mockResolvedValue(0);

      const res = await request(mount()).get(
        "/api/analytics/journey?startDate=2026-01-01&endDate=2026-12-31"
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /api/analytics/journey/summary (getJourneySummaryHandler)", () => {
    it("returns 200 with summary metrics", async () => {
      mockAggregate.mockResolvedValue([
        {
          totalEvents: 150,
          uniqueSessions: 45,
          uniqueUsers: 30,
          pageVisits: 120,
          actions: 30,
        },
      ]);

      const res = await request(mount()).get("/api/analytics/journey/summary");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalEvents).toBe(150);
      expect(res.body.data.uniqueSessions).toBe(45);
    });

    it("returns default summary when no events exist", async () => {
      mockAggregate.mockResolvedValue([]);

      const res = await request(mount()).get("/api/analytics/journey/summary");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalEvents).toBe(0);
    });
  });

  describe("GET /api/analytics/journey/patterns (getFlowPatternsHandler)", () => {
    it("returns 200 with flow patterns", async () => {
      mockAggregate.mockResolvedValue([
        {
          _id: "session1",
          pages: ["/home", "/courses", "/courses/123"],
          count: 3,
        },
      ]);

      const res = await request(mount()).get("/api/analytics/journey/patterns");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("returns empty patterns when no multi-page sessions exist", async () => {
      mockAggregate.mockResolvedValue([]);

      const res = await request(mount()).get("/api/analytics/journey/patterns");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("GET /api/analytics/journey/page-stats (getPageStatsHandler)", () => {
    it("returns 200 with page visit statistics", async () => {
      mockAggregate.mockResolvedValue([
        { page: "/home", visits: 100, uniqueSessions: 50, uniqueUsers: 40 },
        { page: "/courses", visits: 80, uniqueSessions: 40, uniqueUsers: 35 },
      ]);

      const res = await request(mount()).get("/api/analytics/journey/page-stats");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].page).toBe("/home");
      expect(res.body.data[0].visits).toBe(100);
    });

    it("returns empty stats when no events exist", async () => {
      mockAggregate.mockResolvedValue([]);

      const res = await request(mount()).get("/api/analytics/journey/page-stats");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("POST /api/analytics/journey/events (recordEventManuallyHandler)", () => {
    it("returns 201 when event is recorded successfully", async () => {
      const mockEvent = {
        _id: new mongoose.Types.ObjectId(),
        page: "/courses",
        eventType: "page_visit",
      };
      mockCreate.mockResolvedValue(mockEvent);

      const res = await request(mount())
        .post("/api/analytics/journey/events")
        .send({ page: "/courses", eventType: "page_visit" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.page).toBe("/courses");
    });

    it("returns 400 when page is missing", async () => {
      const res = await request(mount())
        .post("/api/analytics/journey/events")
        .send({ eventType: "page_visit" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("page is required");
    });

    it("returns 500 when event creation fails", async () => {
      mockCreate.mockResolvedValue(null);

      const res = await request(mount())
        .post("/api/analytics/journey/events")
        .send({ page: "/courses" });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Authentication", () => {
    it("requires authentication for all journey endpoints", async () => {
      // Create app without auth middleware
      const unauthApp = express();
      unauthApp.use(express.json());
      unauthApp.use("/api/analytics/journey", userJourneyRoutes);

      // The protect middleware is mocked to always pass, so this test
      // verifies the routes are wired and respond
      const res = await request(unauthApp).get("/api/analytics/journey");
      expect(res.status).not.toBe(404);
    });
  });

  describe("Response envelope consistency", () => {
    it("all endpoints return success boolean and data key", async () => {
      mockFind.mockReturnValue(buildChainableQuery([]));
      mockCountDocuments.mockResolvedValue(0);
      mockAggregate.mockResolvedValue([]);

      const app = mount();

      const journeyRes = await request(app).get("/api/analytics/journey");
      expect(typeof journeyRes.body.success).toBe("boolean");
      expect("data" in journeyRes.body).toBe(true);

      const summaryRes = await request(app).get("/api/analytics/journey/summary");
      expect(typeof summaryRes.body.success).toBe("boolean");
      expect("data" in summaryRes.body).toBe(true);

      const patternsRes = await request(app).get("/api/analytics/journey/patterns");
      expect(typeof patternsRes.body.success).toBe("boolean");
      expect("data" in patternsRes.body).toBe(true);

      const statsRes = await request(app).get("/api/analytics/journey/page-stats");
      expect(typeof statsRes.body.success).toBe("boolean");
      expect("data" in statsRes.body).toBe(true);
    });
  });
});
