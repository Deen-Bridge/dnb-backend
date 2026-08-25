// utils/videoCompositor.js
//
// Dependency-free abstraction that records the *intent* of composing a
// duet/stitch response video against an original reel. It intentionally does
// NOT perform any frame compositing or transcoding (no ffmpeg, no native deps):
// the returned descriptor is metadata that the downstream media pipeline uses
// to render the final composited video asynchronously.
//
//   - duet   -> the response is played side-by-side with the original.
//   - stitch -> a clip of the original is prepended, then the response plays.

export const DUET_TYPES = ["duet", "stitch"];

export const COMPOSITION_LAYOUTS = {
  duet: "side-by-side",
  stitch: "prepend-clip",
};

export const isDuetType = (value) => DUET_TYPES.includes(value);

/**
 * Normalize a stitch clip range. Returns { start, end } in seconds, or null
 * when the range is absent/invalid. `end` must be greater than `start`.
 */
export const normalizeStitchClip = (clip) => {
  if (!clip) return null;
  const start = Number(clip.start);
  const end = Number(clip.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start) return null;
  return { start, end };
};

/**
 * Build a composition descriptor for a duet/stitch response.
 *
 * @param {Object} params
 * @param {"duet"|"stitch"} params.type
 * @param {Object} params.original      - source original reel ({ _id, video, duration })
 * @param {Object} params.response      - the response video ({ video, duration })
 * @param {Object} [params.clip]        - stitch clip range ({ start, end }) in seconds
 * @returns {Object} composition descriptor persisted on the derivative reel
 */
export const buildCompositionDescriptor = ({ type, original, response, clip } = {}) => {
  if (!isDuetType(type)) {
    throw new Error(`Unsupported composition type: ${type}`);
  }

  const descriptor = {
    type,
    layout: COMPOSITION_LAYOUTS[type],
    // Rendering is performed later by the media pipeline; this marks intent.
    status: "pending",
    sources: {
      original: {
        reelId: original?._id ? String(original._id) : null,
        video: original?.video ?? null,
        duration: original?.duration ?? null,
      },
      response: {
        video: response?.video ?? null,
        duration: response?.duration ?? null,
      },
    },
  };

  if (type === "stitch") {
    const range = normalizeStitchClip(clip);
    if (!range) {
      throw new Error(
        "A stitch requires a valid clip range ({ start, end } in seconds, end > start)"
      );
    }
    descriptor.clip = range;
  }

  return descriptor;
};

export default {
  DUET_TYPES,
  COMPOSITION_LAYOUTS,
  isDuetType,
  normalizeStitchClip,
  buildCompositionDescriptor,
};
