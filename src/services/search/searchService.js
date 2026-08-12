import Course from "../../models/Course.js";
import Book from "../../models/Book.js";
import User from "../../models/User.js";
import Space from "../../models/Space.js";
import Reel from "../../models/Reel.js";
import logger from "../../config/logger.js";
import { APIError } from "../../middlewares/errorHandler.js";

const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

export const searchCollections = async ({ q, type = "all", page = 1, limit = 10, sort, filters = {} }) => {
  const normalizedFilters = { ...filters };
  if (filters.minRating !== undefined) {
    const minRating = Number(filters.minRating);
    if (filters.minRating === "" || !Number.isFinite(minRating) || !Number.isInteger(minRating) || minRating < 0 || minRating > 5) {
      throw new APIError("minRating must be a whole number between 0 and 5", 400);
    }
    normalizedFilters.minRating = minRating;
  }
  const validPage = Math.max(1, Number(page) || 1);
  const validLimit = Math.min(100, Math.max(1, Number(limit) || 10));
  const skip = (validPage - 1) * validLimit;
  const parsedLimit = validLimit;
  const searchQuery = getSearchQuery(q);
  const sortOption = getSortOption(q, sort);

  const results = {};
  const pagination = {};

  const searchModel = async (Model, queryBase, allowedFilters, projection, typeName) => {
    const finalQuery = applyFilters({ ...queryBase, ...searchQuery }, normalizedFilters, allowedFilters);
    const finalProjection = getProjection(q, projection);
    
    let dbQuery = Model.find(finalQuery, finalProjection);
    if (Object.keys(sortOption).length > 0) {
      dbQuery = dbQuery.sort(sortOption);
    }
    
    const [items, total] = await Promise.all([
      dbQuery.skip(skip).limit(parsedLimit).lean(),
      Model.countDocuments(finalQuery)
    ]);

    results[typeName] = items;
    pagination[typeName] = {
      total,
      page: validPage,
      limit: parsedLimit,
      pages: Math.ceil(total / parsedLimit),
    };
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
      const educatorsRes = await searchEducators({ q, interest: filters.interest, page, limit });
      results.educators = educatorsRes.results;
      pagination.educators = educatorsRes.pagination;
    })());
  }

  await Promise.all(tasks);

  return { results, pagination };
};

export const searchEducators = async ({ q, interest, page = 1, limit = 10 }) => {
  const validPage = Math.max(1, Number(page) || 1);
  const validLimit = Math.min(100, Math.max(1, Number(limit) || 10));
  const skip = (validPage - 1) * validLimit;
  const parsedLimit = validLimit;
  
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

  let dbQuery = User.find(query, getProjection(q, { name: 1, avatar: 1, bio: 1, stat: 1, interests: 1 }));
  
  const sortOption = getSortOption(q, "relevance");
  if (Object.keys(sortOption).length > 0) {
    dbQuery = dbQuery.sort(sortOption);
  }

  const [educators, total] = await Promise.all([
    dbQuery.skip(skip).limit(parsedLimit).lean(),
    User.countDocuments(query)
  ]);

  return {
    results: educators,
    pagination: {
      total,
      page: validPage,
      limit: parsedLimit,
      pages: Math.ceil(total / parsedLimit),
    }
  };
};
