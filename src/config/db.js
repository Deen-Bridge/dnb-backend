import mongoose from "mongoose";

const connectDB = async () => {
  const maxRetries = 5;
  let retryCount = 0;

  const connectWithRetry = async () => {
    try {
      await mongoose.connect(process.env.MONGO_URI);
      console.log("✅🌿 MongoDB connected successfully");

      // Handle connection events
      mongoose.connection.on("error", (err) => {
        console.error("MongoDB connection error:", err);
      });

      mongoose.connection.on("disconnected", () => {
        console.log("MongoDB disconnected. Attempting to reconnect...");
        connectWithRetry();
      });

      mongoose.connection.on("reconnected", () => {
        console.log("MongoDB reconnected");
      });
    } catch (err) {
      retryCount++;
      console.error(
        `❌💥 MongoDB connection error (Attempt ${retryCount}/${maxRetries}):`,
        err
      );

      if (retryCount < maxRetries) {
        console.log(`Retrying connection in 5 seconds...`);
        setTimeout(connectWithRetry, 5000);
      } else {
        console.error("Max retries reached. Could not connect to MongoDB.");
        process.exit(1);
      }
    }
  };

  await connectWithRetry();
};

export default connectDB;
