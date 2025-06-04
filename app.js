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
  },
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

  socket.on("joinRoom", ({ conversationId }) => {
    if (!conversationId) {
      console.error("No conversationId provided for joinRoom");
      return;
    }
    console.log(`Socket ${socket.id} joined room: ${conversationId}`);
    socket.join(conversationId);

    // Acknowledge room join
    socket.emit("roomJoined", { conversationId });
  });

  socket.on("sendMessage", async (data) => {
    const { conversationId, sender, text } = data;

    if (!conversationId || !sender || !text) {
      console.error("Missing required fields in message data:", data);
      return;
    }

    try {
      const newMessage = await new Message({
        conversationId,
        sender,
        text,
      }).save();

      const populated = await newMessage.populate("sender", "name avatar");

      // Broadcast to all clients in the room including sender
      io.in(conversationId).emit("receiveMessage", populated);

      // Log for debugging
      console.log(`Message sent to room ${conversationId}:`, {
        sender: populated.sender._id,
        text: populated.text,
        timestamp: populated.createdAt,
      });
    } catch (err) {
      console.error("Error saving message:", err.message);
      socket.emit("error", { message: "Failed to save message" });
    }
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
