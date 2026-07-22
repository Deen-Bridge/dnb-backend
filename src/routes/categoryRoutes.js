import express from 'express';
import { getCategories, getCategoryBySlug, createCategory, updateCategory, deleteCategory } from '../controllers/categoryController.js';
import { protect, requireRole } from '../middlewares/authMiddleware.js';
import { cacheMiddleware, invalidateCacheMiddleware } from '../middlewares/cache.js';
import { CACHE_TTL, CACHE_KEYS } from '../utils/cache.js';

const router = express.Router();

const categoriesListCacheKey = () => `${CACHE_KEYS.CATEGORIES}list`;
const categoryDetailCacheKey = (req) => {
  // slug and query params (page, sort) affect the result, so include them in the key
  const qs = new URLSearchParams(req.query).toString();
  return `${CACHE_KEYS.CATEGORY}${req.params.slug}${qs ? '?' + qs : ''}`;
};

router.get('/', cacheMiddleware(CACHE_TTL.CATEGORIES, categoriesListCacheKey), getCategories);
router.get('/:slug', cacheMiddleware(CACHE_TTL.CATEGORIES, categoryDetailCacheKey), getCategoryBySlug);

// Admin CRUD routes
const invalidateCategories = invalidateCacheMiddleware([`${CACHE_KEYS.CATEGORIES}*`, `${CACHE_KEYS.CATEGORY}*`]);

router.post('/', protect, requireRole('admin'), invalidateCategories, createCategory);
router.patch('/:id', protect, requireRole('admin'), invalidateCategories, updateCategory);
router.delete('/:id', protect, requireRole('admin'), invalidateCategories, deleteCategory);

export default router;
