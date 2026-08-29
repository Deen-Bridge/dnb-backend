// routes/api/v2/index.js — Issue #215
/**
 * API v2 route aggregator.
 *
 * v2 is currently a superset of v1.  It is the designated target for any
 * future breaking changes (new response shapes, renamed fields, etc.).
 *
 * To introduce a v2-only endpoint or a changed handler:
 *   1. Create the new controller/service logic.
 *   2. Import the v2-specific route file here instead of (or alongside) v1.
 *   3. Remove (or shadow) the v1 route you are replacing.
 *
 * Until breaking changes are needed, v2 simply delegates to v1 routes so
 * clients can target /api/v2/ and be ready for future changes.
 */
import { Router } from "express";
import v1Router from "../v1/index.js";

const v2Router = Router();

// Inherit all v1 routes — override below as v2 evolves.
v2Router.use("/", v1Router);

// Example v2-only endpoint stub (uncomment when ready):
// import newFeatureRoutes from "../../newFeatureRoutes.js";
// v2Router.use("/new-feature", newFeatureRoutes);

export default v2Router;
