import jwt from "jsonwebtoken";
import logger from "../../config/logger.js";
import { buildMeetingUrl, sanitizeDomain } from "../../utils/jitsi.js";

export const isJwtConfigured = () =>
  Boolean(
    process.env.JITSI_APP_ID &&
      process.env.JITSI_PRIVATE_KEY &&
      (process.env.JITSI_PUBLIC_KEY_ID || process.env.JITSI_KID)
  );

const getPrivateKey = () => {
  const key = process.env.JITSI_PRIVATE_KEY;

  if (!key) {
    throw new Error(
      "JITSI_PRIVATE_KEY is not set. Unable to generate Jitsi meeting tokens."
    );
  }

  if (key.includes("-----BEGIN")) {
    return key.replace(/\\n/g, "\n");
  }

  return Buffer.from(key, "base64").toString("utf-8");
};

const resolveSub = () => {
  if (process.env.JITSI_TENANT) {
    return process.env.JITSI_TENANT;
  }

  if (process.env.JITSI_SUB) {
    return process.env.JITSI_SUB;
  }

  const normalizedDomain = sanitizeDomain(
    process.env.JITSI_MEET_DOMAIN || "meet.jit.si"
  );

  const [, tenant] = normalizedDomain.split("/");
  return tenant || normalizedDomain;
};

export const generateJitsiJwt = ({
  roomName,
  userId,
  displayName,
  isModerator,
  email,
  avatar,
}) => {
  const appId = process.env.JITSI_APP_ID;
  const kid = process.env.JITSI_PUBLIC_KEY_ID || process.env.JITSI_KID;

  if (!appId) {
    throw new Error("JITSI_APP_ID is missing.");
  }

  if (!kid) {
    throw new Error(
      "JITSI_PUBLIC_KEY_ID (or JITSI_KID) is missing. Required for JWT header."
    );
  }

  if (!roomName) {
    throw new Error("roomName is required to generate a Jitsi token.");
  }

  const privateKey = getPrivateKey();
  const sub = resolveSub();

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60; // valid for 1 hour

  const payload = {
    aud: "jitsi",
    iss: appId,
    sub,
    room: roomName,
    exp,
    nbf: now - 10,
    moderator: Boolean(isModerator),
    context: {
      user: {
        id: userId,
        name: displayName,
        email,
        avatar,
      },
      features: {
        livestreaming: Boolean(isModerator),
        recording: Boolean(isModerator),
        transcription: false,
        "outbound-call": false,
      },
    },
  };

  logger.info(
    `Generating Jitsi token for room ${roomName} (moderator: ${Boolean(
      isModerator
    )})`
  );

  return jwt.sign(payload, privateKey, {
    algorithm: "RS256",
    header: {
      alg: "RS256",
      kid,
      typ: "JWT",
    },
  });
};

export const ensureMeetingMetadata = (space) => {
  const domain = process.env.JITSI_MEET_DOMAIN || "meet.jit.si";

  if (!space.meetingRoom) {
    const suffix = Math.random().toString(36).slice(2, 8);
    space.meetingRoom = `deenbridge-space-${space._id
      .toString()
      .slice(-6)}-${suffix}`;
  }

  if (!space.meetingUrl) {
    space.meetingUrl = buildMeetingUrl(domain, space.meetingRoom);
  }

  return space;
};

