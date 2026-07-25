import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  listEndpoints,
  createEndpoint,
  getEndpoint,
  updateEndpoint,
  deleteEndpoint,
  rotateSecret,
  listDeliveries,
  redeliver,
  pingEndpoint,
  listEventTypes,
} from "../controllers/webhookController.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Event types catalog (public to authenticated users)
router.get("/events", listEventTypes);

// CRUD
router.get("/", listEndpoints);
router.post("/", createEndpoint);
router.get("/:id", getEndpoint);
router.put("/:id", updateEndpoint);
router.delete("/:id", deleteEndpoint);

// Secret management
router.post("/:id/rotate-secret", rotateSecret);

// Deliveries
router.get("/:id/deliveries", listDeliveries);
router.post("/:id/deliveries/:deliveryId/redeliver", redeliver);

// Integration testing
router.post("/:id/ping", pingEndpoint);

export default router;
