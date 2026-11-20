import crypto from "crypto";

export const MAX_EXPERIMENT_KEY_LENGTH = 100;
export const MAX_METRIC_NAME_LENGTH = 64;
export const MAX_SESSION_TOKEN_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_METADATA_BYTES = 8 * 1024;
export const MAX_CONVERSION_VALUE = 1_000_000_000;

const SESSION_TOKEN_VERSION = "v1";
const SESSION_TOKEN_SECRET = process.env.EXPERIMENT_SESSION_SECRET || process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

const fail = (code: string, message: string) => Object.assign(new Error(message), { code, statusCode: 400 });

export const validateExperimentKey = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)) {
    throw fail("INVALID_EXPERIMENT_KEY", "Invalid experiment key");
  }
  return value;
};

export const validateMetricName = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(value)) {
    throw fail("INVALID_METRIC_NAME", "Invalid metric name");
  }
  return value;
};

export const validateConversionValue = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_CONVERSION_VALUE) {
    throw fail("INVALID_CONVERSION_VALUE", "Conversion value must be a finite bounded number");
  }
  return value;
};

export const validateMetadata = (value: unknown): Record<string, unknown> => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail("INVALID_METADATA", "Metadata must be a JSON object");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw fail("INVALID_METADATA", "Metadata must be JSON serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    throw fail("METADATA_TOO_LARGE", "Metadata exceeds the 8 KB limit");
  }
  return value as Record<string, unknown>;
};

export const validateEventId = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw fail("INVALID_EVENT_ID", "Invalid event ID");
  }
  return value;
};

const sign = (payload: string): string => crypto.createHmac("sha256", SESSION_TOKEN_SECRET).update(payload).digest("base64url");

export const createAnonymousSessionToken = (): string => {
  const payload = `${Date.now()}.${crypto.randomBytes(18).toString("base64url")}`;
  return `${SESSION_TOKEN_VERSION}.${payload}.${sign(payload)}`;
};

export const verifyAnonymousSessionToken = (token: unknown): string => {
  if (typeof token !== "string") throw fail("INVALID_SESSION_TOKEN", "A signed anonymous session token is required");
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== SESSION_TOKEN_VERSION) throw fail("INVALID_SESSION_TOKEN", "Invalid anonymous session token");
  const payload = `${parts[1]}.${parts[2]}`;
  const expected = sign(payload);
  const actual = parts[3];
  if (actual.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    throw fail("INVALID_SESSION_TOKEN", "Invalid anonymous session token");
  }
  const issuedAt = Number(parts[1]);
  if (!Number.isSafeInteger(issuedAt) || Date.now() - issuedAt > MAX_SESSION_TOKEN_AGE_MS || issuedAt > Date.now() + 60_000) {
    throw fail("EXPIRED_SESSION_TOKEN", "Anonymous session token has expired");
  }
  return `anon:${parts[2]}`;
};

export const resolveExperimentIdentity = (options: {
  sessionId?: unknown;
  headerSessionId?: unknown;
  authenticatedUserId?: unknown;
  requestedUserId?: unknown;
}): { identifier: string; sessionToken?: string; userId?: string } => {
  const authenticatedUserId = options.authenticatedUserId ? String(options.authenticatedUserId) : undefined;
  const requestedUserId = options.requestedUserId === undefined || options.requestedUserId === null ? undefined : String(options.requestedUserId);
  if (requestedUserId && !authenticatedUserId) {
    throw Object.assign(new Error("Authentication is required to attribute an experiment event to a user"), { code: "AUTH_REQUIRED_FOR_USER_ID", statusCode: 401 });
  }
  if (requestedUserId && requestedUserId !== authenticatedUserId) {
    throw Object.assign(new Error("userId must match the authenticated user"), { code: "USER_ID_MISMATCH", statusCode: 403 });
  }
  if (authenticatedUserId) {
    const session = options.sessionId ?? options.headerSessionId;
    const identifier = session ? verifyAnonymousSessionToken(session) : `user:${authenticatedUserId}`;
    return { identifier, userId: authenticatedUserId };
  }
  const session = options.sessionId ?? options.headerSessionId;
  if (session) return { identifier: verifyAnonymousSessionToken(session) };
  const sessionToken = createAnonymousSessionToken();
  return { identifier: verifyAnonymousSessionToken(sessionToken), sessionToken };
};
