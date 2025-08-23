import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import connectDB from "./src/config/db.js";
import authRoutes from "./src/routes/authRoutes.js";
import courseRoutes from "./src/routes/courses/courseRoutes.js";
import reelsRoute from "./src/routes/reelsRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import bookRoutes from "./src/routes/books/bookRoutes.js"
import spacesRoutes from "./src/routes/spaceRoutes.js";
import emailRoutes from "./src/routes/emailRoutes.js";
import purchaseRoutes from "./src/routes/books/purchaseBookRoutes.js";
import searchRoutes from "./src/routes/searchRoutes.js";

// Load env
import dotenv from "dotenv";
dotenv.config();

// Connect to MongoDB
connectDB();
const app = express();

// Middlewares
app.use(
  cors({
    origin: ["https://dnb-frontend.vercel.app", "http://localhost:3000"], // Frontend URL
    credentials: true, // Allow cookies
  })
);
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

// TODO: Mount your routes here, e.g.:
app.use("/api/auth", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/reels", reelsRoute);
app.use("/api/books", bookRoutes);
app.use("/api/spaces", spacesRoutes);
app.use("/api/users", userRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/purchase", purchaseRoutes);
app.use("/api/search", searchRoutes);

app.get("/", (req, res) => {
  res.send("🌍 Welcome to DeenBridge API");
});
app.get("/ping", (req, res) => {
  res.status(200).send("ping pong ping pong ping pong");
});

export default app;
