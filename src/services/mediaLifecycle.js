import crypto from "node:crypto";
import cloudinary from "../utils/cloudinary.js";
import logger from "../config/logger.js";

export const MEDIA_STATES = Object.freeze(["pending", "scanned", "attached", "processing", "published", "replaced", "quarantined", "deleted"]);
const TRANSITIONS = {
  pending: new Set(["scanned", "quarantined", "deleted"]), scanned: new Set(["attached", "quarantined", "deleted"]),
  attached: new Set(["processing", "published", "replaced", "quarantined"]), processing: new Set(["published", "quarantined", "deleted"]),
  published: new Set(["replaced", "quarantined", "deleted"]), replaced: new Set(["deleted"]), quarantined: new Set(["scanned", "deleted"]), deleted: new Set(),
};

export function assertMediaTransition(from, to) {
  if (!MEDIA_STATES.includes(from) || !MEDIA_STATES.includes(to) || (from !== to && !TRANSITIONS[from].has(to))) throw new Error(`Invalid media lifecycle transition: ${from} -> ${to}`);
}

export function mediaFingerprint(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function revokeCloudinaryAsset(publicId, resourceType = "raw") {
  if (!publicId) return { deleted: false, reason: "missing_public_id" };
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
    return { deleted: result?.result === "ok", result: result?.result };
  } catch (error) {
    logger.error({ publicId, resourceType, error: error.message }, "media asset cleanup failed");
    return { deleted: false, reason: "provider_error" };
  }
}
