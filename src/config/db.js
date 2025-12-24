import mongoose from "mongoose";
import logger from "./logger.js";

const connectDB = async () => {
  const maxRetries = 5;
  let retryCount = 0;

 
  const options = {
    maxPoolSize: 10, // Maintain up to 10 socket connections
    minPoolSize: 5, // Maintain minimum 5 connections
    serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    family: 4, // Use IPv4, skip trying IPv6
    retryWrites: true,
    w: "majority",
  };

  const connectWithRetry = async () => {
    try {
      await mongoose.connect(process.env.MONGO_URI, options);
      logger.info("MongoDB connected successfully");
      logger.info(`Database: ${mongoose.connection.name}`);
      logger.info(`Host: ${mongoose.connection.host}`);

      // Handle connection events
      mongoose.connection.on("error", (err) => {
        logger.error("MongoDB connection error:", err);
      });

      mongoose.connection.on("disconnected", () => {
        logger.warn("MongoDB disconnected. Attempting to reconnect...");
        if (retryCount < maxRetries) {
          connectWithRetry();
        }
      });

      mongoose.connection.on("reconnected", () => {
        logger.info("MongoDB reconnected successfully");
      });

      mongoose.connection.on("connected", () => {
        logger.info("MongoDB connection established");
      });

      // Graceful shutdown
      process.on("SIGINT", async () => {
        try {
          await mongoose.connection.close();
          logger.info("MongoDB connection closed through app termination");
          process.exit(0);
        } catch (err) {
          logger.error("Error during MongoDB disconnection:", err);
          process.exit(1);
        }
      });
    } catch (err) {
      retryCount++;
      logger.error(
        `MongoDB connection error (Attempt ${retryCount}/${maxRetries}):`,
        err.message
      );

      if (retryCount < maxRetries) {
        logger.info(`Retrying connection in 5 seconds...`);
        setTimeout(connectWithRetry, 5000);
      } else {
        logger.error("Max retries reached. Could not connect to MongoDB.");
        process.exit(1);
      }
    }
  };

  await connectWithRetry();
};

// Monitor MongoDB performance
mongoose.set("debug", (collectionName, method, query, doc) => {
  if (process.env.NODE_ENV === "development") {
    logger.debug(`MongoDB: ${collectionName}.${method}`, {
      query,
      doc,
    });
  }
});

export default connectDB;
