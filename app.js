import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import dotenv from "dotenv";

// Load environment variables first
dotenv.config();

// Import configuration
import connectDB from "./src/config/db.js";
import validateEnv from "./src/config/validateEnv.js";
import logger from "./src/config/logger.js";

// Import middleware
import {
  helmetMiddleware,
  apiLimiter,
  authLimiter,
  mongoSanitizeMiddleware,
  hppMiddleware,
  customSecurityHeaders,
  requestLogger,
} from "./src/middlewares/security.js";
import { sanitizeInput } from "./src/middlewares/validate.js";
import {
  errorHandler,
  notFound,
  handleUnhandledRejection,
  handleUncaughtException,
} from "./src/middlewares/errorHandler.js";

// Import routes
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

// Handle uncaught exceptions
handleUncaughtException();

// Validate environment variables
validateEnv();

// Connect to MongoDB
connectDB();

const app = express();

// Trust proxy (for Heroku, Render, etc.)
app.set("trust proxy", 1);

// ======================
// SECURITY MIDDLEWARE
// ======================

// Helmet - Set security headers
app.use(helmetMiddleware);

// Custom security headers
app.use(customSecurityHeaders);

// CORS configuration with strict options
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      "https://dnb-frontend.vercel.app",
      "http://localhost:3000",
      "https://deenbridge.vercel.app",
    ];

    // Allow requests with no origin (mobile apps, Postman, etc.)
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

// Body parser (limit payload size to prevent DOS attacks)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Cookie parser
app.use(cookieParser());

// Compress responses
app.use(compression());

// Data sanitization against NoSQL query injection
app.use(mongoSanitizeMiddleware);

// Prevent parameter pollution
app.use(hppMiddleware);

// Sanitize user input
app.use(sanitizeInput);

// Request logging
app.use(requestLogger);

// ======================
// ROUTES
// ======================

// Health check (no rate limiting)
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🌍 Welcome to DeenBridge API",
    version: "1.0.0",
    environment: process.env.NODE_ENV,
  });
});

app.get("/ping", (req, res) => {
  res.json({
    success: true,
    message: "pong",
    timestamp: new Date().toISOString(),
  });
});

// API routes with rate limiting
app.use("/api", apiLimiter); // Apply rate limiting to all API routes

// Auth routes with stricter rate limiting
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

// ======================
// ERROR HANDLING
// ======================

// Handle undefined routes (404)
app.use(notFound);

// Global error handler
app.use(errorHandler);

// Handle unhandled promise rejections
handleUnhandledRejection();

// Log server startup
logger.info("🚀 DeenBridge API initialized");
logger.info(`📝 Logging enabled - Level: ${logger.level}`);

export default app;
