import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import courseRoutes from "./routes/courseRoutes.js";
import reelsRoute from "./routes/reelsRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import bookRoutes from "./routes/bookRoutes.js";
import spacesRoutes from "./routes/spaceRoutes.js";
import emailRoutes from "./routes/emailRoutes.js";
import Message from "./models/Message.js";
import messageRoutes from "./routes/messageRoutes.js";
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
  cors: {
    origin: ["https://dnb-frontend.vercel.app", "http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  allowEIO3: true,
  path: "/socket.io",
  serveClient: false,
  cookie: false,
});

// Debug Socket.IO initialization
console.log("🔧 Socket.IO server configuration:", {
  cors: io._opts.cors,
  transports: io._opts.transports,
  path: io._opts.path,
});

// Socket.IO middleware for authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  console.log(
    "🔑 Socket connection attempt with token:",
    token ? "Present" : "Missing"
  );

  // For development, allow connections without token
  if (process.env.NODE_ENV === "development") {
    console.log("🔓 Development mode: Allowing connection without token");
    return next();
  }

  if (!token) {
    console.log("❌ No token provided");
    return next(new Error("Authentication error"));
  }

  // Verify token here if needed
  next();
});

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
app.use("/api/messages", messageRoutes);

// Socket.io for real-time messaging
io.on("connection", (socket) => {
  console.log("⚡ New WebSocket connection:", socket.id);
  console.log("📡 Socket transport:", socket.conn.transport.name);
  console.log(
    "🔑 Auth token:",
    socket.handshake.auth.token ? "Present" : "Missing"
  );

  // Handle transport upgrade
  socket.conn.on("upgrade", (transport) => {
    console.log("🔄 Socket transport upgraded to:", transport.name);
  });

  socket.on("joinRoom", ({ conversationId }, callback) => {
    if (!conversationId) {
      console.error("No conversationId provided for joinRoom");
      if (callback) callback({ error: "No conversationId provided" });
      return;
    }
    console.log(`Socket ${socket.id} joined room: ${conversationId}`);
    socket.join(conversationId);

    // Acknowledge room join
    if (callback) callback({ success: true, conversationId });
    socket.emit("roomJoined", { conversationId });
  });

  socket.on("sendMessage", async (data, callback) => {
    console.log("📨 Received message data:", data);
    const { conversationId, sender, text } = data;

    if (!conversationId || !sender || !text) {
      console.error("❌ Missing required fields in message data:", data);
      if (callback) callback({ error: "Missing required fields" });
      return;
    }

    try {
      console.log("💾 Saving message to database...");
      const newMessage = await new Message({
        conversationId,
        sender,
        text,
      }).save();

      console.log("✅ Message saved:", newMessage);

      const populated = await newMessage.populate("sender", "name avatar");
      console.log("✅ Message populated with sender:", populated);

      // Broadcast to all clients in the room including sender
      io.in(conversationId).emit("receiveMessage", populated);
      console.log(`📢 Message broadcast to room ${conversationId}`);

      // Just acknowledge success without sending the message again
      if (callback) {
        callback({ success: true });
      }

      // Log for debugging
      console.log(`📝 Message details:`, {
        id: populated._id,
        sender: populated.sender._id,
        text: populated.text,
        timestamp: populated.createdAt,
        room: conversationId,
      });
    } catch (err) {
      console.error("❌ Error saving message:", err.message);
      if (callback) {
        callback({ error: "Failed to save message" });
      }
      socket.emit("error", { message: "Failed to save message" });
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("🛑 WebSocket disconnected:", socket.id, "Reason:", reason);
  });

  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });
});

app.get("/", (req, res) => {
  res.send("🌍 Welcome to DeenBridge API");
});
app.get("/ping", (req, res) => {
  res.status(200).send("ping pong ping pong ping pong");
});

export { server }; // so we can start it with HTTP + Socket.io
export default app;
