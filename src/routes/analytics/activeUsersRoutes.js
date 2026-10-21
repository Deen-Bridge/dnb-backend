// routes/analytics/activeUsersRoutes.js
//
// Real-time platform usage endpoints. Mounted at /api/analytics in app.js.
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import { getActiveUsers } from "../../controllers/analytics/activeUsersController.js";

const router = express.Router();

// Current concurrent active user count (any authenticated user may read it).
router.get("/active-users", protect, getActiveUsers);

export default router;
