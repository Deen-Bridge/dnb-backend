import crypto from "node:crypto";
import Credential from "../models/Credential.js";

export const createChallenge = () => crypto.randomBytes(32).toString("base64url");

export const registerCredential = async ({ userId, credentialId, publicKey, counter, transports }) =>
  Credential.create({ user: userId, credentialId, publicKey, counter, transports });

export const listCredentials = (userId) => Credential.find({ user: userId }).select("-publicKey");

export default { createChallenge, registerCredential, listCredentials };
