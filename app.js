import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import courseRoutes from "./routes/courseRoutes.js";
import reelsRoute from "./routes/reelsRoutes.js";
import bookRoutes from "./routes/bookRoutes.js";
import { Server as SocketIOServer } from "socket.io";
import http from "http";



// Load env
import dotenv from "dotenv";
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" },
});

// Middlewares
app.use(
  cors({
    origin: ["https://dnb-frontend.vercel.app","http://localhost:3000"], // Frontend URL
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

// Socket.io for real-time messaging
io.on("connection", (socket) => {
  console.log("⚡ New WebSocket connection:", socket.id);

  socket.on("joinRoom", ({ conversationId }) => {
    socket.join(conversationId);
  });

  socket.on("sendMessage", (data) => {
    io.to(data.conversationId).emit("receiveMessage", data);
    // TODO: Persist message in DB
  });

  socket.on("disconnect", () => {
    console.log("🛑 WebSocket disconnected:", socket.id);
  });
});
app.get("/", (req, res) => {
  res.send("🌍 Welcome to DeenBridge API");
});
export { server }; // so we can start it with HTTP + Socket.io
export default app;
