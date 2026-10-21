import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SECURITY_QUESTION_IDS } from "../constants/securityQuestions.js";

/** trim, lowercase, collapse internal whitespace */
export const normalizeAnswer = (answer) =>
  typeof answer === "string" ? answer.trim().toLowerCase().replace(/\s+/g, " ") : "";

// Same library and cost factor (12) as passwords.
export const hashAnswer = (answer) => bcrypt.hash(normalizeAnswer(answer), 12);

const hmacKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return secret;
};

/**
 * Deterministic fake question ids for unknown users / users without questions,
 * so that /recover/questions/start does not reveal account existence.
 */
export const fakeQuestionIds = (email) => {
  const digest = crypto
    .createHmac("sha256", hmacKey())
    .update(`sq-fake:${String(email).trim().toLowerCase()}`)
    .digest();
  const pool = [...SECURITY_QUESTION_IDS];
  const picked = [];
  for (let i = 0; i < 3; i++) {
    const idx = digest[i] % pool.length;
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
};

// Valid bcrypt hash (cost 12) of a random string, used to equalize timing.
let dummyHashPromise;
export const getDummyHash = () => {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash(crypto.randomBytes(16).toString("hex"), 12);
  }
  return dummyHashPromise;
};
