import express from "express";
import { authorizeRoles, protect } from "../middlewares/authMiddleware.js";
import { cacheMiddleware, invalidateCacheMiddleware } from "../middlewares/cache.js";
import { CACHE_TTL } from "../utils/cache.js";
import { createCategory, deleteCategory, getCategory, listCategories, updateCategory } from "../controllers/categoryController.js";

const router = express.Router();
router.get("/", cacheMiddleware(CACHE_TTL.COURSES, () => "categories:list"), listCategories);
router.get("/:slug", cacheMiddleware(CACHE_TTL.COURSES, (req) => `categories:${req.originalUrl}`), getCategory);
router.post("/", protect, authorizeRoles("admin"), invalidateCacheMiddleware(["categories:*", "courses:*"]), createCategory);
router.patch("/:id", protect, authorizeRoles("admin"), invalidateCacheMiddleware(["categories:*", "courses:*"]), updateCategory);
router.delete("/:id", protect, authorizeRoles("admin"), invalidateCacheMiddleware(["categories:*", "courses:*"]), deleteCategory);
export default router;
