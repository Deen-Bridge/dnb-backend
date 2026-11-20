import Course from "../models/Course.js";
import Book from "../models/Book.js";
import Space from "../models/Space.js";
import User from "../models/User.js";
import { catchAsync } from "../middlewares/errorHandler.js";

// Public profile fields surfaced on educator cards.
const CREATOR_FIELDS = "name avatar role bio";

const VALID_TYPES = new Set(["all", "courses", "books", "spaces"]);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 100;
const QUERY_MAX_TIME_MS = 2000;

/**
 * There is no "list educators" collection — the directory is derived from real
 * content. Every course carries a createdBy, every book an author, every space
 * a host. Aggregating those yields a genuine roster with real contribution
 * counts instead of placeholder people.
 */
export const getEducators = catchAsync(async (req, res) => {
  const { search, type = "all" } = req.query;
  const filterType = VALID_TYPES.has(type) ? type : "all";
  const query = typeof search === "string" ? search.trim() : "";

  if (query.length > MAX_SEARCH_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `search must be ${MAX_SEARCH_LENGTH} characters or fewer`,
    });
  }

  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Math.min(
    Math.max(requestedLimit || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );

  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = {};
  if (filterType !== "all") match[filterType] = { $gt: 0 };
  if (query) {
    const pattern = { $regex: escapeRegex(query), $options: "i" };
    match.$or = [{ name: pattern }, { bio: pattern }];
  }

  const [result] = await Course.aggregate([
    { $project: { owner: "$createdBy", kind: { $literal: "courses" } } },
    {
      $unionWith: {
        coll: Book.collection.name,
        pipeline: [{ $project: { owner: "$author", kind: { $literal: "books" } } }],
      },
    },
    {
      $unionWith: {
        coll: Space.collection.name,
        pipeline: [{ $project: { owner: "$host", kind: { $literal: "spaces" } } }],
      },
    },
    { $match: { owner: { $ne: null } } },
    { $group: { _id: { owner: "$owner", kind: "$kind" }, count: { $sum: 1 } } },
    { $group: { _id: "$_id.owner", counts: { $push: { k: "$_id.kind", v: "$count" } } } },
    { $set: { counts: { $arrayToObject: "$counts" } } },
    {
      $lookup: {
        from: User.collection.name,
        localField: "_id",
        foreignField: "_id",
        pipeline: [{ $project: { _id: 1, ...Object.fromEntries(CREATOR_FIELDS.split(" ").map((field) => [field, 1])) } }],
        as: "person",
      },
    },
    { $unwind: "$person" },
    {
      $project: {
        _id: "$person._id",
        name: { $ifNull: ["$person.name", "Unnamed educator"] },
        avatar: { $ifNull: ["$person.avatar", null] },
        role: { $ifNull: ["$person.role", null] },
        bio: { $ifNull: ["$person.bio", null] },
        courses: { $ifNull: ["$counts.courses", 0] },
        books: { $ifNull: ["$counts.books", 0] },
        spaces: { $ifNull: ["$counts.spaces", 0] },
      },
    },
    {
      $set: {
        role: { $cond: [{ $eq: ["$role", "mentor"] }, "Mentor", null] },
        total: { $add: ["$courses", "$books", "$spaces"] },
      },
    },
    { $facet: {
      totals: [{ $group: {
        _id: null,
        educators: { $sum: 1 },
        courses: { $sum: "$courses" },
        books: { $sum: "$books" },
        spaces: { $sum: "$spaces" },
      } },
        { $project: { _id: 0, educators: 1, courses: 1, books: 1, spaces: 1 } }],
      filteredCount: [
        { $match: match },
        { $count: "value" },
      ],
      data: [
        { $match: match },
        { $sort: { total: -1, name: 1, _id: 1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ],
    } },
  ]).option({ maxTimeMS: QUERY_MAX_TIME_MS });

  const totals = result?.totals?.[0] || { educators: 0, courses: 0, books: 0, spaces: 0 };
  const data = result?.data || [];
  const total = result?.filteredCount?.[0]?.value || 0;

  res.status(200).json({
    success: true,
    data,
    meta: {
      ...totals,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});
