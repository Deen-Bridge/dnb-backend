/**
 * Opaque cursors for keyset ("seek") pagination.
 *
 * A cursor records the sort key of the last item on a page so the next page
 * can resume with a range query instead of an ever-growing skip offset. The
 * payload is tagged with a `kind` so a cursor minted by one endpoint cannot be
 * replayed against another, and it is base64url-encoded so clients treat it as
 * an opaque token rather than something to construct by hand.
 */

export const MAX_CURSOR_LENGTH = 256;

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * @param {string} kind - short tag identifying the endpoint that issued it
 * @param {Date} at - primary sort key of the last item on the page
 * @param {string|object} [id] - ObjectId tiebreaker, when the sort needs one
 * @returns {string}
 */
export const encodeCursor = (kind, at, id) => {
  const payload = { k: kind, t: new Date(at).toISOString() };
  if (id !== undefined && id !== null) payload.id = String(id);
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
};

/**
 * Decode a cursor previously produced by {@link encodeCursor}.
 *
 * @param {unknown} raw - value taken straight from the query string
 * @param {string} kind - the kind this endpoint expects
 * @param {{ requireId?: boolean }} [opts]
 * @returns {{ at: Date, id?: string } | null} null when the cursor is malformed,
 *   oversized, or was issued for a different endpoint
 */
export const decodeCursor = (raw, kind, { requireId = false } = {}) => {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) return null;
  if (!BASE64URL_PATTERN.test(raw)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || payload.k !== kind || typeof payload.t !== "string") {
    return null;
  }

  const at = new Date(payload.t);
  if (Number.isNaN(at.getTime())) return null;

  if (payload.id === undefined) {
    return requireId ? null : { at };
  }
  if (typeof payload.id !== "string" || !OBJECT_ID_PATTERN.test(payload.id)) return null;
  return { at, id: payload.id };
};
