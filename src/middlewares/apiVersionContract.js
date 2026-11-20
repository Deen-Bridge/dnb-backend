/**
 * The release contract for the versioned API.
 *
 * Keep compatibility policy here so a route cannot silently change its
 * version semantics. A future breaking change must add a v2 route and update
 * this contract before it is released.
 */
export const API_VERSION_CONTRACT = Object.freeze({
  latest: 1,
  supported: Object.freeze([1, 2]),
  v1: Object.freeze({ status: "stable", breakingChanges: false }),
  v2: Object.freeze({ status: "compatibility", breakingChanges: true }),
  minimumV1SupportMonths: 6,
});

const parseSunset = () => {
  const value = process.env.API_V1_SUNSET_DATE;
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ? null : date.toUTCString();
};

/** Add version and optional deprecation metadata to every versioned response. */
export const apiVersionContractHeaders = (req, res, next) => {
  const versionedPath = /^\/api\/v\d+(?:\/|$)/.test(req.path);
  const version = versionedPath ? req.apiVersion : null;
  if (version) {
    res.setHeader("X-API-Version", `v${version}`);
    res.setHeader("X-API-Stability", version === 1 ? "stable" : "compatibility");
  }

  const sunset = version === 1 ? parseSunset() : null;
  if (sunset) {
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", sunset);
    res.setHeader("Link", '</docs/api-versioning>; rel="deprecation"');
  }

  next();
};
