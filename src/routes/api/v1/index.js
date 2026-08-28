// routes/api/v1/index.js — Issue #215
/**
 * API v1 route aggregator.
 *
 * All existing routes are considered v1.  This index re-exports them so
 * they can be mounted under the `/api/v1/` prefix in addition to the
 * legacy `/api/` prefix (which defaults to v1 via versionMiddleware).
 *
 * Adding a route here automatically makes it available under v1.
 * Routes that change behaviour between versions should be placed in the
 * appropriate version-specific file instead of the shared app.js.
 */
import { Router } from "express";

// -- Auth & Users --
import authRoutes from "../../authRoutes.js";
import userRoutes from "../../userRoutes.js";

// -- Content --
import reelsRoute from "../../reelsRoutes.js";
import hashtagRoutes from "../../hashtagRoutes.js";
import bookRoutes from "../../books/bookRoutes.js";
import spaceRoutes from "../../spaceRoutes.js";
import spaceRecordingRoutes from "../../spaceRecordingRoutes.js";
import courseRoutes from "../../courses/courseRoutes.js";
import categoryRoutes from "../../categoryRoutes.js";
import searchRoutes from "../../searchRoutes.js";

// -- Notifications & Calls --
import notificationRoutes from "../../notificationRoutes.js";
import callRoutes from "../../callRoutes.js";

// -- Educators & Payments --
import educatorRoutes from "../../educatorRoutes.js";
import payoutRoutes from "../../payoutRoutes.js";

const v1Router = Router();

v1Router.use("/auth", authRoutes);
v1Router.use("/users", userRoutes);
v1Router.use("/reels", reelsRoute);
v1Router.use("/hashtags", hashtagRoutes);
v1Router.use("/books", bookRoutes);
v1Router.use("/spaces", spaceRoutes);
v1Router.use("/spaces/:spaceId/recordings", spaceRecordingRoutes);
v1Router.use("/courses", courseRoutes);
v1Router.use("/categories", categoryRoutes);
v1Router.use("/search", searchRoutes);
v1Router.use("/notifications", notificationRoutes);
v1Router.use("/calls", callRoutes);
v1Router.use("/educators", educatorRoutes);
v1Router.use("/payouts", payoutRoutes);

export default v1Router;
