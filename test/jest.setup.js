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
process.env.MONGOMS_VERSION = "7.0.14";
process.env.MONGOMS_CHECK_MD5 = "false";

// Prevent tests from sending real emails or connecting to external services
for (const variable of [
  "REDIS_URL",
  "ADMIN_EMAILS",
  "SENDLIB_API_KEY",
  "SENDLIB_API_URL",
]) {
  delete process.env[variable];
}

// The app is deliberately importable without a database. Individual
// integration suites opt into MongoMemoryServer or the CI Mongo service.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-key-at-least-32-characters-long";
process.env.PORT = process.env.PORT || "5000";
process.env.CLOUDINARY_CLOUD_NAME =
  process.env.CLOUDINARY_CLOUD_NAME || "test_cloud";
process.env.CLOUDINARY_API_KEY =
  process.env.CLOUDINARY_API_KEY || "test_key";
process.env.CLOUDINARY_API_SECRET =
  process.env.CLOUDINARY_API_SECRET || "test_secret_that_should_not_leak";

if (typeof jest !== "undefined") {
  jest.setTimeout(60000);
}
