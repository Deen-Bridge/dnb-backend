import { server } from "./app.js";
const PORT = process.env.PORT || 5000;

// Add error handling for the server
server.on("error", (error) => {
  console.error("❌ Server error:", error);
});

// Add listening event handler
server.on("listening", () => {
  const addr = server.address();
  const bind = typeof addr === "string" ? "pipe " + addr : "port " + addr.port;
  console.log(`🚀🕌 DeenBridge API running on ${bind}`);
  console.log(`📡 Socket.IO server initialized and listening on ${bind}`);
});

// Start the server
server.listen(PORT, () => {
  console.log(`✅🌿 MongoDB connected successfully`);
  console.log(`🔌 Socket.IO server ready for connections`);
});
