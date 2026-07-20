import mongoose from "mongoose";
import logger from "./logger.js";

const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS || "200", 10);

mongoose.plugin(function slowQueryPlugin(schema) {
  function logIfSlow(op) {
    return function (result) {
      const elapsed = Date.now() - (this._startTime || Date.now());
      if (elapsed > SLOW_QUERY_MS) {
        const filter = this.getQuery ? sanitizeFilter(this.getQuery()) : undefined;
        logger.warn(
          { collection: schema.name, op, durationMs: elapsed, filter },
          `Slow query: ${op} on ${schema.name} took ${elapsed}ms`
        );
      }
    };
  }

  schema.pre("find", function () { this._startTime = Date.now(); });
  schema.pre("findOne", function () { this._startTime = Date.now(); });
  schema.pre("countDocuments", function () { this._startTime = Date.now(); });
  schema.pre("updateOne", function () { this._startTime = Date.now(); });
  schema.pre("deleteOne", function () { this._startTime = Date.now(); });

  schema.post("find", logIfSlow("find"));
  schema.post("findOne", logIfSlow("findOne"));
  schema.post("countDocuments", logIfSlow("countDocuments"));
  schema.post("updateOne", logIfSlow("updateOne"));
  schema.post("deleteOne", logIfSlow("deleteOne"));
});

function sanitizeFilter(filter) {
  if (!filter) return undefined;
  const sanitized = { ...filter };
  Object.keys(sanitized).forEach((key) => {
    if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeFilter(sanitized[key]);
    }
  });
  return sanitized;
}

const connectDB = async () => {
  const maxRetries = 5;
  let retryCount = 0;

  const options = {
    maxPoolSize: 10,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4,
    retryWrites: true,
    w: "majority",
  };

  const connectWithRetry = async () => {
    try {
      await mongoose.connect(process.env.MONGO_URI, options);
      logger.info("MongoDB connected successfully");
      logger.info(`Database: ${mongoose.connection.name}`);
      logger.info(`Host: ${mongoose.connection.host}`);

      mongoose.connection.on("error", (err) => {
        logger.error(err, "MongoDB connection error");
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

      process.on("SIGINT", async () => {
        try {
          await mongoose.connection.close();
          logger.info("MongoDB connection closed through app termination");
          process.exit(0);
        } catch (err) {
          logger.error(err, "Error during MongoDB disconnection");
          process.exit(1);
        }
      });
    } catch (err) {
      retryCount++;
      logger.error(
        `MongoDB connection error (Attempt ${retryCount}/${maxRetries}): ${err.message}`
      );

      if (retryCount < maxRetries) {
        logger.info("Retrying connection in 5 seconds...");
        setTimeout(connectWithRetry, 5000);
      } else {
        logger.error("Max retries reached. Could not connect to MongoDB.");
        process.exit(1);
      }
    }
  };

  await connectWithRetry();
};

export default connectDB;
