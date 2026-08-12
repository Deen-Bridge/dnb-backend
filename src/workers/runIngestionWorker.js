import dotenv from "dotenv";
dotenv.config();

import connectDB from "../config/db.js";
import validateEnv from "../config/validateEnv.js";
import logger from "../config/logger.js";
import { startIngestionWorker } from "./paymentIngestionWorker.js";

validateEnv();

connectDB()
  .then(() => startIngestionWorker())
  .catch((error) => {
    logger.error(error, "Failed to start ingestion worker");
    process.exit(1);
  });

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
