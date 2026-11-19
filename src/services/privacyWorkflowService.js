import crypto from "crypto";
import User from "../models/User.js";
import Session from "../models/Session.js";
import Notification from "../models/Notification.js";
import UserPreferences from "../models/UserPreferences.js";
import ReadingProgress from "../models/ReadingProgress.js";
import UserJourneyEvent from "../models/user-journey-event.js";
import PrivacyRequest from "../models/PrivacyRequest.js";
import { deleteCachePattern } from "../utils/cache.js";
import { recordAudit } from "./audit/auditService.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";

const MAX_EXPORT_ROWS = 1000;
const EXPORT_TTL_MS = 15 * 60 * 1000;
const INVENTORY = [
  { name: "notifications", model: Notification, filter: "recipient", projection: "-_id -__v" },
  { name: "preferences", model: UserPreferences, filter: "user", projection: "-_id -__v" },
  { name: "readingProgress", model: ReadingProgress, filter: "user", projection: "-_id -__v" },
  { name: "journeyEvents", model: UserJourneyEvent, filter: "userId", projection: "-_id -__v -ipHash" },
];
const USER_PROJECTION = "-password -twoFactor.secret -twoFactor.pendingSecret -twoFactor.recoveryCodes -resetTokenHash -resetTokenExpiry";

function hashExportToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function encryptionKey() {
  const raw = process.env.PRIVACY_EXPORT_ENCRYPTION_KEY;
  if (!raw) {
    throw Object.assign(new Error("PRIVACY_EXPORT_ENCRYPTION_KEY is required for exports"), { statusCode: 503 });
  }
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw Object.assign(new Error("PRIVACY_EXPORT_ENCRYPTION_KEY must encode 32 bytes"), { statusCode: 503 });
  }
  return key;
}

function encryptArchive(payload, token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    tokenHash: hashExportToken(token),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptArchive(archive, token) {
  const expected = Buffer.from(archive.tokenHash || "", "hex");
  const actual = Buffer.from(hashExportToken(token || ""), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw Object.assign(new Error("Invalid export token"), { statusCode: 404 });
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(archive.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(archive.tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(archive.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8"));
}

export const PRIVACY_INVENTORY = Object.freeze([
  "user profile",
  "sessions and refresh tokens",
  "notifications",
  "preferences",
  "reading progress",
  "journey analytics",
  "media references",
  "financial and audit records retained for legal obligations",
]);

async function collectExport(userId) {
  const user = await User.findById(userId).select(USER_PROJECTION).lean();
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });
  const data = { user, collections: {}, retention: {
    omitted: ["passwords", "refresh tokens", "audit logs", "payment ledger rows"],
    reason: "credentials are never exported; financial and audit records follow retention/legal-hold policy",
  } };
  for (const item of INVENTORY) {
    data.collections[item.name] = await item.model.find({ [item.filter]: userId })
      .select(item.projection).limit(MAX_EXPORT_ROWS).lean();
  }
  return data;
}

async function runStep(request, name, fn) {
  if (request.completedSteps.includes(name)) return;
  try {
    await fn();
    request.completedSteps.push(name);
    request.failedSteps = request.failedSteps.filter((step) => step !== name);
  } catch (error) {
    if (!request.failedSteps.includes(name)) request.failedSteps.push(name);
    request.error = (name + ": " + error.message).slice(0, 500);
  }
  await request.save();
}

async function processDeletion(request, req) {
  const userId = request.user;
  await runStep(request, "revoke-sessions", () =>
    Session.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } })
  );
  await runStep(request, "delete-user-caches", () =>
    deleteCachePattern("user:" + userId + "*")
  );
  await runStep(request, "delete-user-data", async () => {
    for (const item of INVENTORY) await item.model.deleteMany({ [item.filter]: userId });
  });
  await runStep(request, "quarantine-account", () =>
    User.updateOne(
      { _id: userId },
      {
        $set: {
          name: "Deleted user",
          email: "deleted+" + userId + "@invalid.local",
          isActive: false,
          avatar: null,
          bio: null,
          following: [],
          followers: [],
          purchasedBooks: [],
          purchasedCourses: [],
        },
        $unset: {
          password: 1,
          googleId: 1,
          resetTokenHash: 1,
          resetTokenExpiry: 1,
          "twoFactor.secret": 1,
          "twoFactor.pendingSecret": 1,
          "twoFactor.recoveryCodes": 1,
        },
      }
    )
  );
  await recordAudit({
    action: AUDIT_ACTIONS.PRIVACY_DELETE_COMPLETED,
    actor: userId,
    req,
    targetType: "User",
    targetId: userId,
    status: request.failedSteps.length ? "failure" : "success",
    metadata: { reason: request.failedSteps.length ? request.error : "privacy deletion completed" },
  });
}

export async function createPrivacyRequest({ userId, type, requestKey, req }) {
  let request = await PrivacyRequest.findOne({ user: userId, type, requestKey });
  if (!request) {
    request = await PrivacyRequest.create({ user: userId, type, requestKey });
    await recordAudit({
      action: type === "export" ? AUDIT_ACTIONS.PRIVACY_EXPORT_REQUESTED : AUDIT_ACTIONS.PRIVACY_DELETE_REQUESTED,
      actor: userId, req, targetType: "User", targetId: userId, status: "success",
    });
  }
  request.status = "running";
  await request.save();
  let downloadToken = null;
  if (type === "export") {
    const data = await collectExport(userId);
    downloadToken = crypto.randomBytes(32).toString("hex");
    request.archive = {
      encrypted: true,
      expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
      data: encryptArchive(data, downloadToken),
    };
    request.completedSteps = ["inventory-export"];
    request.progress = 100;
  } else {
    await processDeletion(request, req);
    request.progress = request.failedSteps.length ? 75 : 100;
  }
  request.status = request.failedSteps.length ? "partial" : "completed";
  request.completedAt = request.failedSteps.length ? null : new Date();
  await request.save();
  return { request, downloadToken };
}

export async function getPrivacyRequest({ userId, requestId }) {
  return PrivacyRequest.findOne({ _id: requestId, user: userId }).lean();
}

export async function downloadPrivacyExport({ userId, requestId, token }) {
  const request = await PrivacyRequest.findOne({ _id: requestId, user: userId }).select("+archive.data");
  if (!request || request.type !== "export" || !request.archive?.data) {
    throw Object.assign(new Error("Export not found"), { statusCode: 404 });
  }
  if (request.archive.consumedAt || !request.archive.expiresAt || request.archive.expiresAt <= new Date()) {
    throw Object.assign(new Error("Export has expired"), { statusCode: 410 });
  }
  const payload = decryptArchive(request.archive.data, token);
  request.archive.consumedAt = new Date();
  await request.save();
  return payload;
}

export async function retryPrivacyRequest({ userId, requestId, req }) {
  const request = await PrivacyRequest.findOne({ _id: requestId, user: userId });
  if (!request) throw Object.assign(new Error("Privacy request not found"), { statusCode: 404 });
  if (request.type !== "delete") throw Object.assign(new Error("Only deletion requests can be retried"), { statusCode: 400 });
  await processDeletion(request, req);
  request.status = request.failedSteps.length ? "partial" : "completed";
  request.progress = request.failedSteps.length ? 75 : 100;
  request.completedAt = request.failedSteps.length ? null : new Date();
  await request.save();
  return request;
}
