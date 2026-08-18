// routes/webhookRoutes.js
//
// Management API for outbound webhooks. Mounted at /api/webhooks in app.js.
// Every route requires an authenticated admin (issue #20 role gate).
import express from "express";
import { protect, authorizeRoles } from "../middlewares/authMiddleware.js";
import {
  createEndpoint,
  listEndpoints,
  getEndpoint,
  updateEndpoint,
  deleteEndpoint,
  rotateSecret,
  listDeliveries,
  redeliver,
  pingEndpoint,
} from "../controllers/webhookController.js";

const router = express.Router();

// Authentication + admin privilege gate for the whole management surface.
router.use(protect);
router.use(authorizeRoles("admin"));

// Endpoint CRUD
router.post("/", createEndpoint);
router.get("/", listEndpoints);
router.get("/:id", getEndpoint);
router.patch("/:id", updateEndpoint);
router.delete("/:id", deleteEndpoint);

// Secret rotation
router.post("/:id/rotate-secret", rotateSecret);

// Deliveries + dead-letter redelivery
router.get("/:id/deliveries", listDeliveries);
router.post("/:id/deliveries/:deliveryId/redeliver", redeliver);

// Integration-test ping
router.post("/:id/ping", pingEndpoint);

export default router;
