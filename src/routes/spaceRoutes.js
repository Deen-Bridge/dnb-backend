import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/upload.js";

import {
  getSpaces,
  getSpaceById,
  createSpace,
  updateSpace,
  joinWaitList,
  deleteSpace,
  getSpacesByHost
} from "../controllers/spaceController.js";

const router = express.Router();

// Get all spaces
router.get("/", getSpaces);
// Get all spaces by host (user)
router.get("/by-host/:hostId", getSpacesByHost);
// Get a single space by ID
router.get("/:id", getSpaceById);
// Create a new space
router.post(
  "/",
  protect,
  upload.fields([{ name: "thumbnail", maxCount: 1 }]),
  createSpace
);
router.post("/:id/waitlist", protect, joinWaitList);
// Update a space
router.put("/update/:id", protect, updateSpace);
// Delete a space
router.delete("/:id", protect, deleteSpace);

export default router;
