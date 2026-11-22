// validators/courseBundleValidators.js
// Request contracts for the course-bundle routes (issue #697). Every bundle
// route runs one of these chains followed by the shared `validate` middleware,
// so malformed ids, oversized course lists, unknown/server-owned fields and
// unbounded list requests are rejected before the service touches MongoDB.
import { body, param, query } from "express-validator";
import { APIError } from "../middlewares/errorHandler.js";
import { getSupportedCodes } from "../config/assets.js";

export const MAX_BUNDLE_COURSES = 20;
export const MAX_BUNDLE_TITLE_LENGTH = 200;
export const MAX_BUNDLE_DESCRIPTION_LENGTH = 5000;
export const MAX_BUNDLE_PRICE = 1_000_000;
// Stellar amounts carry at most 7 decimal places.
export const MAX_PRICE_DECIMALS = 7;

export const DEFAULT_BUNDLE_PAGE_SIZE = 20;
export const MAX_BUNDLE_PAGE_SIZE = 50;
// Caps the skip offset (MAX_BUNDLE_PAGE * MAX_BUNDLE_PAGE_SIZE documents).
export const MAX_BUNDLE_PAGE = 500;
export const MAX_BUNDLE_SEARCH_LENGTH = 100;

// Sort keys a client may request, mapped to the sort the service applies.
// `_id` is always appended as a tiebreaker so pages are stable.
export const BUNDLE_SORTS = Object.freeze({
  "-createdAt": { createdAt: -1 },
  createdAt: { createdAt: 1 },
  price: { price: 1 },
  "-price": { price: -1 },
  "-discountPercentage": { discountPercentage: -1 },
});
export const DEFAULT_BUNDLE_SORT = "-createdAt";

const MUTABLE_BUNDLE_FIELDS = ["title", "description", "courses", "price", "currency"];
const LIST_QUERY_FIELDS = ["page", "limit", "sort", "courseId", "createdBy", "search"];
const PAGINATION_QUERY_FIELDS = ["page", "limit", "sort"];

/**
 * Reject request keys outside an explicit allowlist. Server-owned fields such
 * as `createdBy`, `isActive`, `originalPrice` and `discountPercentage` are never
 * on an allowlist, so clients cannot set them through the API.
 *
 * @param {"body"|"query"} location
 * @param {string[]} allowed
 */
const rejectUnknownFields = (location, allowed) => {
  const allowedSet = new Set(allowed);
  return (req, _res, next) => {
    const source = req[location];
    if (source === undefined || source === null) return next();
    if (typeof source !== "object" || Array.isArray(source)) {
      return next(
        new APIError("Validation failed", 400, true, [
          { field: location, message: `${location} must be an object` },
        ])
      );
    }

    const unknown = Object.keys(source).filter((key) => !allowedSet.has(key));
    if (unknown.length === 0) return next();

    return next(
      new APIError(
        "Request contains unknown or read-only fields",
        400,
        true,
        unknown.slice(0, 20).map((field) => ({ field, message: "Field is not allowed" }))
      )
    );
  };
};

// Standard validators run per element when handed an array (`price: [1]`
// passes isFloat), so scalar fields must assert their type explicitly.
const isScalar = (value) => typeof value === "string" || typeof value === "number";

const hasAllowedPrecision = (value) => {
  const [, decimals = ""] = String(value).split(".");
  return decimals.length <= MAX_PRICE_DECIMALS;
};

const idParam = (name) => param(name).isMongoId().withMessage(`${name} must be a valid id`);

const titleRule = (chain) =>
  chain
    .isString().withMessage("title must be a string").bail()
    .trim()
    .isLength({ min: 1, max: MAX_BUNDLE_TITLE_LENGTH })
    .withMessage(`title must be 1-${MAX_BUNDLE_TITLE_LENGTH} characters`);

const descriptionRule = (chain) =>
  chain
    .isString().withMessage("description must be a string").bail()
    .trim()
    .isLength({ min: 1, max: MAX_BUNDLE_DESCRIPTION_LENGTH })
    .withMessage(`description must be 1-${MAX_BUNDLE_DESCRIPTION_LENGTH} characters`);

const coursesRule = (chain) =>
  chain
    .isArray({ min: 1, max: MAX_BUNDLE_COURSES })
    .withMessage(`courses must be an array of 1-${MAX_BUNDLE_COURSES} course ids`)
    .bail()
    .custom((courses) => courses.every((id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id)))
    .withMessage("courses must only contain valid course ids")
    .bail()
    .custom((courses) => new Set(courses.map((id) => id.toLowerCase())).size === courses.length)
    .withMessage("courses must not contain duplicates");

const priceRule = (chain) =>
  chain
    .custom(isScalar).withMessage("price must be a number").bail()
    .isFloat({ min: 0, max: MAX_BUNDLE_PRICE })
    .withMessage(`price must be between 0 and ${MAX_BUNDLE_PRICE}`)
    .bail()
    .custom(hasAllowedPrecision)
    .withMessage(`price must have at most ${MAX_PRICE_DECIMALS} decimal places`)
    .toFloat();

// Evaluated per request so the allowlist tracks the configured Stellar network.
const currencyRule = (chain) =>
  chain
    .isString().withMessage("currency must be a string").bail()
    .custom((value) => getSupportedCodes().includes(value))
    .withMessage("currency is not supported");

const required = (field) => body(field).exists({ values: "null" }).withMessage(`${field} is required`).bail();
const optional = (field) => body(field).optional();

const paginationRules = [
  query("page")
    .optional()
    .custom(isScalar).withMessage("page must be an integer").bail()
    .isInt({ min: 1, max: MAX_BUNDLE_PAGE })
    .withMessage(`page must be an integer between 1 and ${MAX_BUNDLE_PAGE}`)
    .toInt(),
  query("limit")
    .optional()
    .custom(isScalar).withMessage("limit must be an integer").bail()
    .isInt({ min: 1, max: MAX_BUNDLE_PAGE_SIZE })
    .withMessage(`limit must be an integer between 1 and ${MAX_BUNDLE_PAGE_SIZE}`)
    .toInt(),
  query("sort")
    .optional()
    .isIn(Object.keys(BUNDLE_SORTS))
    .withMessage(`sort must be one of: ${Object.keys(BUNDLE_SORTS).join(", ")}`),
];

export const bundleIdValidation = [idParam("id")];

export const createBundleValidation = [
  rejectUnknownFields("body", MUTABLE_BUNDLE_FIELDS),
  titleRule(required("title")),
  descriptionRule(required("description")),
  coursesRule(required("courses")),
  priceRule(required("price")),
  currencyRule(optional("currency")),
];

export const updateBundleValidation = [
  idParam("id"),
  rejectUnknownFields("body", MUTABLE_BUNDLE_FIELDS),
  body()
    .custom((payload) => MUTABLE_BUNDLE_FIELDS.some((field) => payload?.[field] !== undefined))
    .withMessage(`Provide at least one of: ${MUTABLE_BUNDLE_FIELDS.join(", ")}`),
  titleRule(optional("title")),
  descriptionRule(optional("description")),
  coursesRule(optional("courses")),
  priceRule(optional("price")),
  currencyRule(optional("currency")),
];

// Purchase and delete take no body; anything sent is a client mistake.
export const bundleActionValidation = [idParam("id"), rejectUnknownFields("body", [])];

export const listBundlesValidation = [
  rejectUnknownFields("query", LIST_QUERY_FIELDS),
  ...paginationRules,
  query("courseId").optional().isMongoId().withMessage("courseId must be a valid id"),
  query("createdBy").optional().isMongoId().withMessage("createdBy must be a valid id"),
  query("search")
    .optional()
    .isString().withMessage("search must be a string").bail()
    .trim()
    .isLength({ min: 1, max: MAX_BUNDLE_SEARCH_LENGTH })
    .withMessage(`search must be 1-${MAX_BUNDLE_SEARCH_LENGTH} characters`),
];

export const bundlesByCourseValidation = [
  idParam("courseId"),
  rejectUnknownFields("query", PAGINATION_QUERY_FIELDS),
  ...paginationRules,
];
