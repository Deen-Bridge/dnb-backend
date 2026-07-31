import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load test environment variables from .env.test if it exists
// In CI environments, these should be provided via environment variables
const envPath = path.resolve(process.cwd(), ".env.test");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // If no .env.test is found, we assume environment variables are set (e.g. in CI)
  // We'll also just call dotenv.config() as a fallback
  dotenv.config();
}

// Force NODE_ENV to test to ensure we don't accidentally connect to production
process.env.NODE_ENV = "test";
for (const variable of ["MONGO_URI", "JWT_SECRET", "PORT"]) {
  if (!process.env[variable]) {
    throw new Error(`${variable} must be set when running tests`);
  }
}

if (typeof jest !== "undefined") {
  jest.setTimeout(60000);
}

