const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

const envPath = path.resolve(process.cwd(), ".env.test");
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : undefined);

process.env.NODE_ENV = "test";
process.env.STELLAR_NETWORK = "testnet";
for (const variable of ["REDIS_URL", "ADMIN_EMAILS", "SENDLIB_API_KEY", "SENDLIB_API_URL"]) {
  delete process.env[variable];
}
process.env.JWT_SECRET = "test-secret-key-at-least-32-characters-long";
process.env.PORT = process.env.PORT || "5000";
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test_cloud";
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test_key";
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test_secret_that_should_not_leak";
