import Course from "../../models/Course.js";
import Book from "../../models/Book.js";
import User from "../../models/User.js";
import Space from "../../models/Space.js";
import Reel from "../../models/Reel.js";
import logger from "../../config/logger.js";
import { APIError } from "../../middlewares/errorHandler.js";

const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Encode a MongoDB ObjectId into an opaque cursor string.
 * @param {import("mongoose").Types.ObjectId} id
 * @returns {string}
 */
export const encodeCursor = (id) => Buffer.from(id.toString(), "utf8").toString("base64url");

/**
 * Decode an opaque cursor string back to a string ObjectId.
 * Returns null if the cursor is invalid.
 * @param {string} cursor
 * @returns {string|null}
 */
export const decodeCursor = (cursor) => {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    // Validate it looks like a 24-char hex ObjectId
    if (/^[0-9a-fA-F]{24}$/.test(decoded)) return decoded;
    return null;
  } catch {
    return null;
  }
};

const getSearchQuery = (q) => {
  if (!q) return {};
  if (q.length < 3) {
    const safeQ = escapeRegex(q);
    return {
      $or: [
        { title: { $regex: new RegExp(`^${safeQ}`, "i") } },
        { name: { $regex: new RegExp(`^${safeQ}`, "i") } },
        { description: { $regex: new RegExp(`^${safeQ}`, "i") } }
      ]
    };
  }
  return { $text: { $search: q } };
};

const applyFilters = (baseQuery, filters, allowedFilters) => {
  const query = { ...baseQuery };
  if (allowedFilters.includes("category") && filters.category) {
    query.category = filters.category;
  }
  if (allowedFilters.includes("price")) {
    if (filters.free === "true") {
      query.price = 0;
    } else {
      if (filters.minPrice) query.price = { ...query.price, $gte: Number(filters.minPrice) };
      if (filters.maxPrice) query.price = { ...query.price, $lte: Number(filters.maxPrice) };
    }
  }
  if (allowedFilters.includes("rating") && filters.minRating !== undefined) {
    query.rating = { $gte: filters.minRating };
  }
  return query;
};

const getSortOption = (q, sort) => {
  let sortOption = {};
  if (sort === "price") sortOption.price = 1;
  else if (sort === "price_desc") sortOption.price = -1;
  else if (sort === "rating") sortOption.rating = -1;
  else if (q && q.length >= 3) {
    sortOption.score = { $meta: "textScore" };
  } else {
    sortOption.createdAt = -1;
  }
  return sortOption;
};

const getProjection = (q, baseProjection) => {
  if (q && q.length >= 3) {
    return { ...baseProjection, score: { $meta: "textScore" } };
  }
  return baseProjection;
};

/**
 * Apply cursor-based filtering: `_id < cursorId` (for descending sort by _id/createdAt).
 * For text-search queries the cursor is still `_id`-based but the primary sort
 * is `textScore`, so the cursor provides a best-effort "next page" — results
 * won't repeat, though the sort boundary isn't perfectly aligned with the cursor.
 */
const applyCursorFilter = (query, cursorId) => {
  if (!cursorId) return query;
  return { ...query, _id: { $lt: cursorId } };
};

/**
 * Determine whether cursor-based pagination should be used.
 * Cursor pagination works well for deterministic sorts (createdAt, _id).
 * For text-score and price sorts, offset pagination remains more accurate,
 * but we still return the cursor-shaped envelope for API consistency.
 */
const useCursorPagination = (q, sort) => {
  // Text search uses $meta sort — cursor is best-effort, but still valid
  if (q && q.length >= 3 && !sort) return true;
  // Default sort is createdAt -1, which works perfectly with _id cursor
  if (!sort) return true;
  // Explicit non-score sorts (price, rating) don't pair well with _id cursor
  return false;
};

export const searchCollections = async ({ q, type = "all", page = 1, limit = 10, sort, cursor, filters = {} }) => {
  const normalizedFilters = { ...filters };
  if (filters.minRating !== undefined) {
    const minRating = Number(filters.minRating);
    if (filters.minRating === "" || !Number.isFinite(minRating) || !Number.isInteger(minRating) || minRating < 0 || minRating > 5) {
      throw new APIError("minRating must be a whole number between 0 and 5", 400);
    }
    normalizedFilters.minRating = minRating;
  }

  const validLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const searchQuery = getSearchQuery(q);
  const sortOption = getSortOption(q, sort);
  const cursorMode = useCursorPagination(q, sort);

  let cursorId = null;
  if (cursor) {
    cursorId = decodeCursor(cursor);
    if (!cursorId) {
      throw new APIError("Invalid cursor", 400);
    }
  }

  // In cursor mode we don't use page/skip; in offset mode we keep the old behavior
  const validPage = cursorMode ? 1 : Math.max(1, Number(page) || 1);
  const skip = cursorMode ? 0 : (validPage - 1) * validLimit;

  const results = {};
  const pagination = {};

  const searchModel = async (Model, queryBase, allowedFilters, projection, typeName) => {
    const finalQuery = applyFilters({ ...queryBase, ...searchQuery }, normalizedFilters, allowedFilters);
    const cursorQuery = applyCursorFilter(finalQuery, cursorId);
    const finalProjection = getProjection(q, projection);

    let dbQuery = Model.find(cursorQuery, finalProjection);
    if (Object.keys(sortOption).length > 0) {
      dbQuery = dbQuery.sort(sortOption);
    }

    // Fetch one extra to detect has_more
    const [items, total] = await Promise.all([
      dbQuery.skip(skip).limit(validLimit + 1).lean(),
      Model.countDocuments(finalQuery),
    ]);

    const hasMore = items.length > validLimit;
    const pageItems = hasMore ? items.slice(0, validLimit) : items;
    const lastItem = pageItems.length > 0 ? pageItems[pageItems.length - 1] : null;

    results[typeName] = pageItems;

    if (cursorMode) {
      pagination[typeName] = {
        total,
        limit: validLimit,
        has_more: hasMore,
        next_cursor: hasMore && lastItem ? encodeCursor(lastItem._id) : null,
      };
    } else {
      // Fallback to offset pagination for non-cursor-compatible sorts
      pagination[typeName] = {
        total,
        page: validPage,
        limit: validLimit,
        pages: Math.ceil(total / validLimit),
        next_cursor: hasMore && lastItem ? encodeCursor(lastItem._id) : null,
        has_more: hasMore,
      };
    }
  };

  const tasks = [];

  if (type === "all" || type === "courses") {
    tasks.push(searchModel(Course, {}, ["category", "price", "rating"], { title: 1, description: 1, price: 1, thumbnail: 1, category: 1, rating: 1, numReviews: 1 }, "courses"));
  }
  if (type === "all" || type === "books") {
    tasks.push(searchModel(Book, {}, ["category", "price", "rating"], { title: 1, description: 1, category: 1, price: 1, image: 1, author: 1, rating: 1, numReviews: 1 }, "books"));
  }
  if (type === "all" || type === "spaces") {
    tasks.push(searchModel(Space, {}, ["category", "price"], { title: 1, description: 1, price: 1, status: 1, eventDate: 1, duration: 1, host: 1, category: 1 }, "spaces"));
  }
  if (type === "all" || type === "reels") {
    tasks.push(searchModel(Reel, {}, [], { description: 1, createdBy: 1 }, "reels"));
  }
  if (type === "all" || type === "educators") {
    tasks.push((async () => {
      const educatorsRes = await searchEducators({ q, interest: filters.interest, page, limit, cursor });
      results.educators = educatorsRes.results;
      pagination.educators = educatorsRes.pagination;
    })());
  }

  await Promise.all(tasks);

  return { results, pagination };
};

export const searchEducators = async ({ q, interest, page = 1, limit = 10, cursor }) => {
  const validLimit = Math.min(100, Math.max(1, Number(limit) || 20));

  let cursorId = null;
  if (cursor) {
    cursorId = decodeCursor(cursor);
    if (!cursorId) {
      throw new APIError("Invalid cursor", 400);
    }
  }

  const cursorMode = !!cursor;

  const validPage = cursorMode ? 1 : Math.max(1, Number(page) || 1);
  const skip = cursorMode ? 0 : (validPage - 1) * validLimit;

  let query = { role: "mentor" };
  if (q) {
    if (q.length < 3) {
       const safeQ = escapeRegex(q);
       query.$or = [
         { name: { $regex: new RegExp(`^${safeQ}`, "i") } }
       ];
    } else {
       query.$text = { $search: q };
    }
  }
  if (interest) {
    query.interests = interest;
  }

  const cursorQuery = applyCursorFilter(query, cursorId);

  let dbQuery = User.find(cursorQuery, getProjection(q, { name: 1, avatar: 1, bio: 1, stat: 1, interests: 1 }));

  const sortOption = getSortOption(q, "relevance");
  if (Object.keys(sortOption).length > 0) {
    dbQuery = dbQuery.sort(sortOption);
  }

  const [educators, total] = await Promise.all([
    dbQuery.skip(skip).limit(validLimit + 1).lean(),
    User.countDocuments(query),
  ]);

  const hasMore = educators.length > validLimit;
  const pageItems = hasMore ? educators.slice(0, validLimit) : educators;
  const lastItem = pageItems.length > 0 ? pageItems[pageItems.length - 1] : null;

  if (cursorMode) {
    return {
      results: pageItems,
      pagination: {
        total,
        limit: validLimit,
        has_more: hasMore,
        next_cursor: hasMore && lastItem ? encodeCursor(lastItem._id) : null,
      },
    };
  }

  return {
    results: pageItems,
    pagination: {
      total,
      page: validPage,
      limit: validLimit,
      pages: Math.ceil(total / validLimit),
      next_cursor: hasMore && lastItem ? encodeCursor(lastItem._id) : null,
      has_more: hasMore,
    },
  };
};
