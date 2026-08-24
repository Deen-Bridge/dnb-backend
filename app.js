import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import crypto from "crypto";
import "./src/jobs/handlers.js";

import logger from "./src/config/logger.js";
import { metricsMiddleware, observeHttpDuration } from "./src/config/metrics.js";

import {
  helmetMiddleware,
  standardLimiter,
  generousLimiter,
  authLimiter,
  paymentLimiter,
  mongoSanitizeMiddleware,
  hppMiddleware,
  customSecurityHeaders,
} from "./src/middlewares/security.js";
import { sanitizeInput } from "./src/middlewares/validate.js";
import {
  errorHandler,
  notFound,
} from "./src/middlewares/errorHandler.js";

import authRoutes from "./src/routes/authRoutes.js";
import courseRoutes from "./src/routes/courses/courseRoutes.js";
import reelsRoute from "./src/routes/reelsRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import bookRoutes from "./src/routes/books/bookRoutes.js";
import recommendedBooksRoutes from "./src/routes/books/recommendedBooksRoutes.js";
import spacesRoutes from "./src/routes/spaceRoutes.js";
import emailRoutes from "./src/routes/emailRoutes.js";
import purchaseRoutes from "./src/routes/books/purchaseBookRoutes.js";
import searchRoutes from "./src/routes/searchRoutes.js";
import callRoutes from "./src/routes/callRoutes.js";
import stellarWalletRoutes from "./src/routes/stellar/walletRoutes.js";
import stellarPaymentRoutes from "./src/routes/stellar/paymentRoutes.js";
import stellarDonationRoutes from "./src/routes/stellar/donationRoutes.js";
import stellarPledgeRoutes from "./src/routes/stellar/pledgeRoutes.js";
import stellarGiftRoutes from "./src/routes/stellar/giftRoutes.js";
import stellarReportsRoutes from "./src/routes/stellar/reportsRoutes.js";
import payoutRoutes from "./src/routes/payoutRoutes.js";
import uploadRoutes from "./src/routes/uploadRoutes.js";
import notificationRoutes from "./src/routes/notificationRoutes.js";
import jobsRoutes from "./src/routes/jobsRoutes.js";
import internalAiRoutes from "./src/routes/internal/aiRoutes.js";
import wellKnownRoutes from "./src/routes/wellKnownRoutes.js";
import apiDocsRoutes from "./src/routes/api-docs.js";
import auditRoutes from "./src/routes/admin/auditRoutes.js";
import educatorRoutes from "./src/routes/educatorRoutes.js";
import educatorVerificationRoutes from "./src/routes/educatorVerificationRoutes.js";
import educatorVerificationAdminRoutes from "./src/routes/admin/educatorVerificationAdminRoutes.js";
import webhookRoutes from "./src/routes/webhookRoutes.js";
import categoryRoutes from "./src/routes/categoryRoutes.js";
import { healthCheck, ping } from "./src/controllers/healthController.js";

const app = express();

app.set("trust proxy", 1);

// ======================
// REQUEST ID / LOGGING
// ======================

app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || crypto.randomUUID();
  req.log = logger.child({ reqId: req.id });
  res.setHeader("X-Request-Id", req.id);
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? "warn" : "info";
    req.log[level](
      { method: req.method, url: req.originalUrl, status: res.statusCode, durationMs: duration },
      `${req.method} ${req.originalUrl} ${res.statusCode}`
    );
  });
  next();
});

// HTTP duration observation for Prometheus
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const route = req.route?.path || req.baseUrl || req.path;
    observeHttpDuration(req.method, route, res.statusCode, Date.now() - start);
  });
  next();
});

// ======================
// METRICS (before rate limiter)
// ======================

app.get("/metrics", metricsMiddleware);

// ======================
// SECURITY MIDDLEWARE
// ======================

app.use(helmetMiddleware);
app.use(customSecurityHeaders);

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      "https://dnb-frontend.vercel.app",
      "http://localhost:3000",
      "http://localhost:3001",
      "https://deenbridge.vercel.app",
      "http://deenbridge.vercel.app",
    ];

    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn(`Blocked CORS request from origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// Capture the raw request bytes so the service-to-service auth middleware can
// verify HMAC signatures over the exact body (see middlewares/serviceAuth.js).
// This only stashes a Buffer reference and does not alter parsing behaviour.
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(compression());
app.use(mongoSanitizeMiddleware);
app.use(hppMiddleware);
app.use(sanitizeInput);

// ======================
// ROUTES
// ======================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to DeenBridge API",
    version: "1.0.0",
    environment: process.env.NODE_ENV,
  });
});

app.get("/ping", ping);
app.get("/health", healthCheck);

// SEP-1 stellar.toml — must be outside /api rate limiter
app.use("/.well-known", wellKnownRoutes);

// Interactive API documentation (Swagger UI) — served from openapi.yaml
app.use("/api-docs", apiDocsRoutes);

// Auth routes — strict
app.use("/api/auth", authLimiter, authRoutes);

// Mutation routes — standard limiter
app.use("/api/email", standardLimiter, emailRoutes);
app.use("/api/purchase", standardLimiter, purchaseRoutes);
app.use("/api/uploads", standardLimiter, uploadRoutes);
app.use("/api/payouts", standardLimiter, payoutRoutes);

// Read-heavy & content routes — generous limiter
app.use("/api/courses", generousLimiter, courseRoutes);
app.use("/api/categories", generousLimiter, categoryRoutes);
app.use("/api/reels", generousLimiter, reelsRoute);
app.use("/api/books", generousLimiter, bookRoutes);
app.use("/api/books", generousLimiter, recommendedBooksRoutes);
app.use("/api/spaces", generousLimiter, spacesRoutes);
app.use("/api/users", generousLimiter, userRoutes);
app.use("/api/search", generousLimiter, searchRoutes);
app.use("/api/calls", generousLimiter, callRoutes);
app.use("/api/educators", generousLimiter, educatorRoutes);
app.use("/api/educator-verification", standardLimiter, educatorVerificationRoutes);
app.use("/api/stellar/wallet", generousLimiter, stellarWalletRoutes);
// Payment routes mutate money state — stricter per-user limiter (issue #4).
app.use("/api/stellar/payment", paymentLimiter, stellarPaymentRoutes);
app.use("/api/stellar/donation", generousLimiter, stellarDonationRoutes);
app.use("/api/stellar/pledges", generousLimiter, stellarPledgeRoutes);
app.use("/api/stellar/gifts", generousLimiter, stellarGiftRoutes);
app.use("/api/stellar/reports", standardLimiter, stellarReportsRoutes);
app.use("/api/notifications", generousLimiter, notificationRoutes);

// Outbound webhook management API (admin-gated)
app.use("/api/webhooks", standardLimiter, webhookRoutes);

// Internal service-to-service (dnb-ai) — signed-request auth, no user JWTs
app.use("/api/internal/ai", internalAiRoutes);

// Admin — no rate limit
app.use("/admin/jobs", jobsRoutes);
app.use("/api/admin/audit", auditRoutes);
app.use("/api/admin/educator-verification", educatorVerificationAdminRoutes);

// ======================
// ERROR HANDLING
// ======================

app.use(notFound);
app.use(errorHandler);

logger.info("DeenBridge API initialized");
logger.info(`Logging enabled - Level: ${logger.level}`);

export default app;
