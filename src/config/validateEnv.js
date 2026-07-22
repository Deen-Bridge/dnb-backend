import logger from "./logger.js";

/**
 * Validate required environment variables
 */
const requiredEnvVars = ["MONGO_URI", "JWT_SECRET", "NODE_ENV", "PORT"];

const optionalEnvVars = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "BLOCKED_IPS",
  "JITSI_MEET_DOMAIN",
  "JITSI_APP_ID",
  "JITSI_PRIVATE_KEY",
  "JITSI_PUBLIC_KEY_ID",
  "JITSI_KID",
  "JITSI_TENANT",
  "STELLAR_NETWORK",
  "DONATION_WALLET_PUBLIC_KEY",
  "PLATFORM_FEE_PERCENT",
  "PLATFORM_WALLET_PUBLIC_KEY",
  "PLATFORM_COLLECT_ENABLED",
  "PAYOUT_ADMIN_USER_IDS",
  "ACCESS_TOKEN_TTL",
  "REFRESH_TOKEN_TTL",
  "QUEUE_DRIVER",
  "JOBS_ENABLED",
  "JOBS_DASHBOARD_TOKEN",
  "EMAILJS_RECEIPT_TEMPLATE_ID",
  "ANCHOR_HOME_DOMAINS",
  "ANCHOR_TOML_CACHE_TTL",
  // Redis configuration (optional - app works without Redis)
  "REDIS_URL",
  "REDIS_HOST",
  "REDIS_PORT",
  "REDIS_USERNAME",
  "REDIS_PASSWORD",
];

export const validateEnv = () => {
  // Default values for TTLs if not provided
  process.env.ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "15m";
  process.env.REFRESH_TOKEN_TTL = process.env.REFRESH_TOKEN_TTL || "30d";

  // Anchor allowlist defaults to Stellar's public test anchor on testnet only;
  // mainnet requires an operator to explicitly opt in to a real anchor domain.
  if (
    !process.env.ANCHOR_HOME_DOMAINS &&
    (process.env.STELLAR_NETWORK || "testnet") === "testnet"
  ) {
    process.env.ANCHOR_HOME_DOMAINS = "testanchor.stellar.org";
  }
  process.env.ANCHOR_TOML_CACHE_TTL = process.env.ANCHOR_TOML_CACHE_TTL || "3600";

  const missing = [];

  requiredEnvVars.forEach((envVar) => {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  });

  if (missing.length > 0) {
    logger.error(
      `❌ Missing required environment variables: ${missing.join(", ")}`
    );
    logger.error(
      "Please check your .env file and ensure all required variables are set."
    );
    process.exit(1);
  }

  // Check JWT_SECRET strength
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    logger.warn(
      "⚠️  JWT_SECRET is too short! Use at least 32 characters for production."
    );
  }

  // Check NODE_ENV
  if (!["development", "production", "test"].includes(process.env.NODE_ENV)) {
    logger.warn(
      `⚠️  NODE_ENV is set to '${process.env.NODE_ENV}'. Expected: development, production, or test`
    );
  }

  // Log optional missing variables
  const missingOptional = optionalEnvVars.filter(
    (envVar) => !process.env[envVar]
  );
  if (missingOptional.length > 0 && process.env.NODE_ENV === "production") {
    logger.warn(
      `⚠️  Optional environment variables not set: ${missingOptional.join(
        ", "
      )}`
    );
  }

  logger.info("✅ Environment variables validated successfully");
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`Port: ${process.env.PORT}`);
};

export default validateEnv;
