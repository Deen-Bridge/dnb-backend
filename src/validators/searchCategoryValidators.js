// validators/searchCategoryValidators.js
import { body, param, query } from "express-validator";

// Values the search service / category controller actually act on.
export const SEARCH_TYPES = ["all", "courses", "books", "spaces", "reels", "educators"];
export const SEARCH_SORTS = ["price", "price_desc", "rating", "newest", "relevance"];
export const CATEGORY_SORTS = ["newest", "popular", "price"];

const MAX_QUERY_LENGTH = 100;
const MAX_PAGE = 10000;
const MAX_LIMIT = 100;

const optionalQuery = (name) => query(name).optional({ values: "undefined" });

const searchTerm = optionalQuery("q")
  .isString()
  .withMessage("q must be a string");
// The 100-character cap on q is enforced by the controller with its own
// "Query string is too long." response, which clients already rely on.

const pagination = [
  optionalQuery("page")
    .isInt({ min: 1, max: MAX_PAGE })
    .withMessage(`page must be an integer between 1 and ${MAX_PAGE}`),
  optionalQuery("limit")
    .isInt({ min: 1, max: MAX_LIMIT })
    .withMessage(`limit must be an integer between 1 and ${MAX_LIMIT}`),
  optionalQuery("cursor")
    .isString()
    .withMessage("cursor must be a string")
    .bail()
    .isLength({ max: 200 })
    .withMessage("cursor must be at most 200 characters"),
];

const shortString = (name) =>
  optionalQuery(name)
    .isString()
    .withMessage(`${name} must be a string`)
    .bail()
    .isLength({ max: MAX_QUERY_LENGTH })
    .withMessage(`${name} must be at most ${MAX_QUERY_LENGTH} characters`);

// GET /api/search
export const searchValidation = [
  searchTerm,
  ...pagination,
  optionalQuery("type")
    .isIn(SEARCH_TYPES)
    .withMessage(`type must be one of: ${SEARCH_TYPES.join(", ")}`),
  optionalQuery("sort")
    .isIn(SEARCH_SORTS)
    .withMessage(`sort must be one of: ${SEARCH_SORTS.join(", ")}`),
  optionalQuery("minPrice").isFloat({ min: 0 }).withMessage("minPrice must be a number >= 0"),
  optionalQuery("maxPrice").isFloat({ min: 0 }).withMessage("maxPrice must be a number >= 0"),
  // minRating is validated (whole number 0-5) by the search service itself.
  optionalQuery("free").isIn(["true", "false", "1", "0"]).withMessage("free must be true or false"),
  shortString("category"),
  shortString("interest"),
];

// GET /api/search/educators
export const searchEducatorsValidation = [searchTerm, ...pagination, shortString("interest")];

const categoryIdParam = param("id").isMongoId().withMessage("A valid category id is required");

// GET /api/categories/:slug
export const categorySlugValidation = [
  param("slug")
    .isString()
    .trim()
    .isLength({ min: 1, max: MAX_QUERY_LENGTH })
    .withMessage(`slug must be 1-${MAX_QUERY_LENGTH} characters`),
  optionalQuery("page")
    .isInt({ min: 1, max: MAX_PAGE })
    .withMessage(`page must be an integer between 1 and ${MAX_PAGE}`),
  optionalQuery("limit")
    .isInt({ min: 1, max: MAX_LIMIT })
    .withMessage(`limit must be an integer between 1 and ${MAX_LIMIT}`),
  optionalQuery("sort")
    .isIn(CATEGORY_SORTS)
    .withMessage(`sort must be one of: ${CATEGORY_SORTS.join(", ")}`),
];

// Optional fields shared by create and update. null/"" are accepted for
// description/icon/image/parent since the controller tolerates them.
const categoryFields = [
  body("slug")
    .optional({ values: "null" })
    .isString()
    .withMessage("slug must be a string")
    .bail()
    .isLength({ max: MAX_QUERY_LENGTH })
    .withMessage(`slug must be at most ${MAX_QUERY_LENGTH} characters`),
  body("description")
    .optional({ values: "null" })
    .isString()
    .withMessage("description must be a string")
    .bail()
    .isLength({ max: 1000 })
    .withMessage("description must be at most 1000 characters"),
  body("icon")
    .optional({ values: "null" })
    .isString()
    .withMessage("icon must be a string")
    .bail()
    .isLength({ max: 500 })
    .withMessage("icon must be at most 500 characters"),
  body("image")
    .optional({ values: "null" })
    .isString()
    .withMessage("image must be a string")
    .bail()
    .isLength({ max: 500 })
    .withMessage("image must be at most 500 characters"),
  body("parent")
    .optional({ values: "falsy" })
    .isMongoId()
    .withMessage("parent must be a valid category id"),
  body("order").optional({ values: "null" }).isInt({ min: 0, max: 100000 }).withMessage("order must be a non-negative integer"),
  body("isActive").optional({ values: "null" }).isBoolean().withMessage("isActive must be a boolean"),
];

// POST /api/categories
export const createCategoryValidation = [
  body("name")
    .exists({ values: "null" })
    .withMessage("Category name is required")
    .bail()
    .isString()
    .withMessage("name must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Category name is required")
    .bail()
    .isLength({ max: MAX_QUERY_LENGTH })
    .withMessage(`name must be at most ${MAX_QUERY_LENGTH} characters`),
  ...categoryFields,
];

// PATCH /api/categories/:id
export const updateCategoryValidation = [
  categoryIdParam,
  body("name")
    .optional({ values: "undefined" })
    .isString()
    .withMessage("name must be a string")
    .bail()
    .isLength({ max: MAX_QUERY_LENGTH })
    .withMessage(`name must be at most ${MAX_QUERY_LENGTH} characters`),
  ...categoryFields,
];

// DELETE /api/categories/:id
export const deleteCategoryValidation = [categoryIdParam];
