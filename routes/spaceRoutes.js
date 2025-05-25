import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  getSpaces,
  getSpaceById,
  createSpace,
  updateSpace,
  deleteSpace
} from "../controllers/spaceController.js";

const router = express.Router();

// Get all spaces
router.get("/", protect, getSpaces);
// Get a single space by ID
router.get("/:id", protect, getSpaceById);
// Create a new space
router.post("/", protect, createSpace);
// Update a space
router.put("/:id", protect, updateSpace);
// Delete a space
router.delete("/:id", protect, deleteSpace);

export default router;