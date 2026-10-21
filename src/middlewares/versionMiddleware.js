// middlewares/versionMiddleware.js — Issue #215
/**
 * API version middleware.
 *
 * Reads the API version from the request path (`/api/v1/...`, `/api/v2/...`)
 * and attaches `req.apiVersion` (number) for use by downstream handlers.
 *
 * Behaviour:
 *   - `/api/v1/...`  → req.apiVersion = 1
 *   - `/api/v2/...`  → req.apiVersion = 2
 *   - `/api/...`     → req.apiVersion = LATEST_VERSION (redirect behaviour
 *                       is handled in the router, not here)
 *   - Unknown version → 400 Bad Request
 *
 * Supported versions are listed in SUPPORTED_VERSIONS.  Add a new entry
 * when a new major version ships.
 */

/** The latest stable version — `/api/` with no prefix resolves here. */
export const LATEST_VERSION = 1;

/** All versions currently accepting traffic. */
export const SUPPORTED_VERSIONS = new Set([1, 2]);

/**
 * Express middleware.  Mount early in the request pipeline so every handler
 * can read req.apiVersion.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export const versionMiddleware = (req, res, next) => {
  // Match /api/v<N>/ prefix in the full URL.
  const match = req.path.match(/^\/api\/v(\d+)\//);

  if (match) {
    const version = Number(match[1]);
    if (!SUPPORTED_VERSIONS.has(version)) {
      return res.status(400).json({
        success: false,
        error: `API version v${version} is not supported. Supported versions: ${[...SUPPORTED_VERSIONS].map((v) => `v${v}`).join(", ")}`,
      });
    }
    req.apiVersion = version;
  } else {
    // No version prefix → default to latest stable.
    req.apiVersion = LATEST_VERSION;
  }

  next();
};

/**
 * Route-level guard: ensure the request is for a specific minimum version.
 *
 * Usage:
 *   router.get('/new-feature', requireVersion(2), handler);
 *
 * @param {number} minVersion
 */
export const requireVersion = (minVersion) => (req, res, next) => {
  if ((req.apiVersion ?? LATEST_VERSION) >= minVersion) return next();
  return res.status(400).json({
    success: false,
    error: `This endpoint requires API v${minVersion} or later. Use /api/v${minVersion}/ prefix.`,
  });
};
