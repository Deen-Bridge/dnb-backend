import crypto from "node:crypto";

const PLACEHOLDER = /^(?:change(?:me)?|replace(?:me)?|your[_-]?|example|test|dummy|placeholder)/i;
const SECRET_NAMES = ["JWT_SECRET", "WEBHOOK_SECRET_ENCRYPTION_KEY", "AI_SERVICE_KEYS"];
const URL_NAMES = ["CORS_ALLOWED_ORIGINS", "HORIZON_URLS", "SEP10_HOME_DOMAIN", "SEP10_WEB_AUTH_DOMAIN", "SEP10_WEB_AUTH_ENDPOINT", "SENDLIB_API_URL", "JITSI_MEET_DOMAIN"];

const present = (env, name) => String(env[name] ?? "").trim();

function addUrlProblems(problems, name, raw, { https = false, allowComma = false } = {}) {
  for (const value of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
    let url;
    try { url = new URL(value.includes("://") ? value : `https://${value}`); } catch { problems.push(`${name} contains an invalid URL`); continue; }
    if (https && url.protocol !== "https:") problems.push(`${name} must use HTTPS in production`);
    if (url.username || url.password) problems.push(`${name} must not contain URL credentials`);
    if (!allowComma && raw.includes(",")) problems.push(`${name} must contain one URL`);
  }
}

export function validateProductionConfiguration(env = process.env) {
  const problems = [];
  if (env.NODE_ENV !== "production") return problems;

  for (const name of SECRET_NAMES) {
    const value = present(env, name);
    if (!value) problems.push(`${name} is required in production`);
    else if (PLACEHOLDER.test(value)) problems.push(`${name} contains a placeholder value`);
  }
  if (present(env, "JWT_SECRET").length < 32) problems.push("JWT_SECRET must be at least 32 characters in production");

  const origins = present(env, "CORS_ALLOWED_ORIGINS");
  if (origins.includes("*")) problems.push("CORS_ALLOWED_ORIGINS must not contain a wildcard");
  if (origins) addUrlProblems(problems, "CORS_ALLOWED_ORIGINS", origins, { https: true, allowComma: true });
  for (const name of URL_NAMES.filter((item) => item !== "CORS_ALLOWED_ORIGINS")) {
    if (present(env, name)) addUrlProblems(problems, name, present(env, name), { https: name !== "HORIZON_URLS" });
  }

  const cookieDomain = present(env, "COOKIE_DOMAIN");
  if (cookieDomain.startsWith(".") || cookieDomain.includes("localhost")) problems.push("COOKIE_DOMAIN must be an explicit production domain");
  if (present(env, "WEBHOOK_BASE_URL")) addUrlProblems(problems, "WEBHOOK_BASE_URL", present(env, "WEBHOOK_BASE_URL"), { https: true });
  if (present(env, "EMAIL_FROM") && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(present(env, "EMAIL_FROM"))) problems.push("EMAIL_FROM must be a valid sender address");
  if ((present(env, "CLOUDINARY_CLOUD_NAME") && !present(env, "CLOUDINARY_API_KEY")) || (!present(env, "CLOUDINARY_CLOUD_NAME") && present(env, "CLOUDINARY_API_KEY"))) problems.push("Cloudinary cloud name and API key must be configured together");
  if (present(env, "STELLAR_NETWORK") === "mainnet" && /testnet/i.test(present(env, "HORIZON_URLS"))) problems.push("mainnet cannot use a testnet Horizon URL");
  return problems;
}

export function configurationFingerprint(env = process.env) {
  const names = Object.keys(env).filter((name) => /^(NODE_ENV|STELLAR_|HORIZON_|CORS_|COOKIE_|WEBHOOK_|EMAIL_|CLOUDINARY_|SENDLIB_|JITSI_)/.test(name)).sort();
  const material = names.map((name) => `${name}=${present(env, name)}`).join("\n");
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
}

export function redactedConfigurationDiagnostics(env = process.env) {
  return { environment: env.NODE_ENV ?? "unknown", stellarNetwork: env.STELLAR_NETWORK ?? "unset", fingerprint: configurationFingerprint(env) };
}
