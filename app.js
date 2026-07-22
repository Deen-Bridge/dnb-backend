import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import dotenv from "dotenv";
import crypto from "crypto";
import "./src/jobs/handlers.js";

dotenv.config();

import connectDB from "./src/config/db.js";
import validateEnv from "./src/config/validateEnv.js";
import logger from "./src/config/logger.js";
import { registry, metricsMiddleware, observeHttpDuration } from "./src/config/metrics.js";

import {
  helmetMiddleware,
  apiLimiter,
  authLimiter,
  mongoSanitizeMiddleware,
  hppMiddleware,
  customSecurityHeaders,
} from "./src/middlewares/security.js";
import { sanitizeInput } from "./src/middlewares/validate.js";
import {
  errorHandler,
  notFound,
  handleUnhandledRejection,
  handleUncaughtException,
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
import payoutRoutes from "./src/routes/payoutRoutes.js";
import jobsRoutes from "./src/routes/jobsRoutes.js";

handleUncaughtException();
validateEnv();

// Connect to MongoDB (skip during tests as tests handle their own connections)
if (process.env.NODE_ENV !== "test") {
  connectDB();
}

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

app.use(express.json({ limit: "10mb" }));
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

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "pong",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", apiLimiter);

// Auth routes
app.use("/api/auth", authLimiter, authRoutes);

// Other API routes
app.use("/api/courses", courseRoutes);
app.use("/api/reels", reelsRoute);
app.use("/api/books", bookRoutes);
app.use("/api/books", recommendedBooksRoutes);
app.use("/api/spaces", spacesRoutes);
app.use("/api/users", userRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/purchase", purchaseRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/stellar/wallet", stellarWalletRoutes);
app.use("/api/stellar/payment", stellarPaymentRoutes);
app.use("/api/stellar/donation", stellarDonationRoutes);
app.use("/api/stellar/pledges", stellarPledgeRoutes);
app.use("/api/payouts", payoutRoutes);
app.use("/admin/jobs", jobsRoutes);

// ======================
// ERROR HANDLING
// ======================

app.use(notFound);
app.use(errorHandler);
handleUnhandledRejection();

logger.info("DeenBridge API initialized");
logger.info(`Logging enabled - Level: ${logger.level}`);

export default app;
