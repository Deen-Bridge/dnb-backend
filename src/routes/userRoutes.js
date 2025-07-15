import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/upload.js";
import {
  updateUser,
  getUser,
  deleteUser,
} from "../controllers/userController.js";
import { searchAll } from "../controllers/searchController.js";

const router = express.Router();

// Update user profile (with avatar upload)
router.put("/update/:id", protect, upload.single("avatar"), updateUser);
// Get user by ID
router.get("/:id", protect, getUser);
// Delete user
router.delete("/:id", protect, deleteUser);

// Remove search endpoint

export default router;
