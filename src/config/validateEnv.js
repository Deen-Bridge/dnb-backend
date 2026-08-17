import logger from "./logger.js";

/**
 * Always required in all environments
 */
const ALWAYS_REQUIRED = ["MONGO_URI", "JWT_SECRET", "NODE_ENV", "PORT"];

/**
 * Required in production when payments are enabled
 */
const PAYMENT_REQUIRED = [
  "DONATION_WALLET_PUBLIC_KEY",
  "PLATFORM_WALLET_PUBLIC_KEY",
];

/**
 * Required in production for Stellar/SEP-10
 */
const STELLAR_REQUIRED = [
  "SEP10_SIGNING_SECRET",
  "SEP10_HOME_DOMAIN",
  "SEP10_WEB_AUTH_DOMAIN",
];

/**
 * Required in production for email
 */
const EMAIL_REQUIRED = [
  "SENDLIB_API_URL",
];

/**
 * Optional environment variables
 */
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
  "SEP10_CHALLENGE_TIMEOUT",
  "SEP10_WEB_AUTH_ENDPOINT",
  "PLATFORM_FEE_PERCENT",
  "PLATFORM_COLLECT_ENABLED",
  "PAYOUT_ADMIN_USER_IDS",
  "ACCESS_TOKEN_TTL",
  "REFRESH_TOKEN_TTL",
  "EMAIL_FROM",
  "FRONTEND_URL",
  "EMAIL_ASSET_URL",
  // Redis configuration (optional - app works without Redis)
  "REDIS_URL",
  "REDIS_HOST",
  "REDIS_PORT",
  "REDIS_USERNAME",
  "REDIS_PASSWORD",
  "HORIZON_URLS",
  "HORIZON_TIMEOUT_MS",
  "HORIZON_MAX_RETRIES",
  "HORIZON_CB_THRESHOLD",
  "HORIZON_CB_COOLDOWN_MS",
  "QUEUE_DRIVER",
  "JOBS_ENABLED",
  "JOBS_DASHBOARD_TOKEN",
  "STELLAR_PLATFORM_PUBLIC_KEY",
  "ORG_NAME",
  "ORG_URL",
  "ORG_DESCRIPTION",
  "ORG_LOGO",
  "ORG_TWITTER",
  "ORG_GITHUB",
  "SIGNING_KEY",
  "INGESTION_WORKER_ENABLED",
  "INGESTION_POLL_INTERVAL_MS",
];

export const validateEnv = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const isTest = process.env.NODE_ENV === "test";
  const errors = [];

  // ========================================
  // ALWAYS REQUIRED
  // ========================================
  for (const key of ALWAYS_REQUIRED) {
    if (!process.env[key]) {
      errors.push(`Missing required env var: ${key}`);
    }
  }

  // ========================================
  // PRODUCTION-ONLY REQUIRED SETS
  // ========================================
  if (isProduction) {
    for (const key of [...PAYMENT_REQUIRED, ...STELLAR_REQUIRED, ...EMAIL_REQUIRED]) {
      if (!process.env[key]) {
        errors.push(`Missing required production env var: ${key}`);
      }
    }
  }

  // ========================================
  // FORMAT VALIDATION (all except test)
  // ========================================
  if (!isTest) {
    // Stellar public key format: starts with G, 56 chars
    const stellarPubKeyVars = ["DONATION_WALLET_PUBLIC_KEY", "PLATFORM_WALLET_PUBLIC_KEY"];
    for (const key of stellarPubKeyVars) {
      const val = process.env[key];
      if (val && (val.length !== 56 || !val.startsWith("G"))) {
        errors.push(
          `Invalid Stellar public key format for ${key}: must start with G and be 56 characters`
        );
      }
    }

    // URL format validation
    const urlVars = ["SENDLIB_API_URL", "FRONTEND_URL", "EMAIL_ASSET_URL"];
    for (const key of urlVars) {
      const val = process.env[key];
      if (val && val !== "" && val !== "http://localhost") {
        try {
          new URL(val);
        } catch {
          errors.push(`Invalid URL format for ${key}: "${val}"`);
        }
      }
    }

    // JWT_SECRET minimum length (error in production, warn in dev)
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret && jwtSecret.length < 32) {
      if (isProduction) {
        errors.push(`JWT_SECRET is too short (${jwtSecret.length} chars, minimum 32)`);
      } else {
        logger.warn(
          `⚠️  JWT_SECRET is short (${jwtSecret.length} chars) — use 32+ in production`
        );
      }
    }

    // Numeric field validation
    const port = parseInt(process.env.PORT, 10);
    if (process.env.PORT && (isNaN(port) || port < 1 || port > 65535)) {
      errors.push(`Invalid PORT value: "${process.env.PORT}" must be a number 1-65535`);
    }
  }

  // ========================================
  // FAIL-FAST: EXIT ON VALIDATION ERRORS
  // ========================================
  if (errors.length > 0) {
    console.error("\n[validateEnv] Boot aborted — configuration errors:\n");
    errors.forEach((e) => console.error(`✗ ${e}`));
    console.error("\nFix the above errors before starting the server.\n");
    process.exit(1);
  }

  // ========================================
  // SET DEFAULTS
  // ========================================

  // Default values for TTLs if not provided
  process.env.ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "15m";
  process.env.REFRESH_TOKEN_TTL = process.env.REFRESH_TOKEN_TTL || "30d";

  // Default values for Horizon resilient client if not provided
  const network = process.env.STELLAR_NETWORK || "testnet";
  if (!process.env.HORIZON_URLS) {
    process.env.HORIZON_URLS =
      network === "mainnet"
        ? "https://horizon.stellar.org"
        : "https://horizon-testnet.stellar.org";
  }
  process.env.HORIZON_TIMEOUT_MS = process.env.HORIZON_TIMEOUT_MS || "10000";
  process.env.HORIZON_MAX_RETRIES = process.env.HORIZON_MAX_RETRIES || "3";
  process.env.HORIZON_CB_THRESHOLD = process.env.HORIZON_CB_THRESHOLD || "5";
  process.env.HORIZON_CB_COOLDOWN_MS = process.env.HORIZON_CB_COOLDOWN_MS || "30000";

  // ========================================
  // CHECK NODE_ENV
  // ========================================
  if (!["development", "production", "test"].includes(process.env.NODE_ENV)) {
    logger.warn(
      `⚠️  NODE_ENV is set to '${process.env.NODE_ENV}'. Expected: development, production, or test`
    );
  }

  // ========================================
  // LOG OPTIONAL MISSING VARIABLES
  // ========================================
  const missingOptional = optionalEnvVars.filter((envVar) => !process.env[envVar]);
  if (missingOptional.length > 0 && isProduction) {
    logger.warn(
      `⚠️  Optional environment variables not set: ${missingOptional.join(", ")}`
    );
  }

  logger.info("✅ Environment variables validated successfully");
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`Port: ${process.env.PORT}`);
};

export default validateEnv;
