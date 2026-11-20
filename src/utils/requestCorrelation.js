import crypto from "crypto";

const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Accept only bounded, opaque correlation IDs. Invalid client values are
 * replaced so callers cannot inject log content or spoof an existing trace.
 */
export const getSafeRequestId = (candidate) =>
  typeof candidate === "string" &&
  candidate.length <= MAX_REQUEST_ID_LENGTH &&
  SAFE_REQUEST_ID.test(candidate)
    ? candidate
    : crypto.randomUUID();

export { MAX_REQUEST_ID_LENGTH };
