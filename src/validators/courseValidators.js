// validators/courseValidators.js
// express-validator chains for course, enrollment, review, purchase and quiz
// routes (issue #415). Chains are intentionally permissive: they reject
// malformed types/IDs and absurd sizes but accept every payload the existing
// controllers already accept. Pair each chain with the shared `validate`
// middleware.
import { body, param, query } from "express-validator";
import { prerequisitesValidation } from "./requestValidators.js";

const idParam = (name) =>
  param(name).isMongoId().withMessage(`${name} must be a valid id`);

const optionalUrl = (field) =>
  body(field)
    .optional({ values: "null" })
    .isString()
    .withMessage(`${field} must be a string`)
    .bail()
    .isLength({ max: 2048 })
    .withMessage(`${field} must be at most 2048 characters`);

const optionalPositiveInt = (name, max) =>
  query(name)
    .optional({ values: "falsy" })
    .isInt({ min: 1, ...(max ? { max } : {}) })
    .withMessage(`${name} must be a positive integer`)
    .toInt();

// Shared course body rules. Create requires title/description/category (the
// controller already rejects them when missing); update treats all as optional.
const courseBodyRules = (required) => {
  const req = (chain, label) =>
    required
      ? chain.exists({ values: "falsy" }).withMessage(`${label} is required`).bail()
      : chain.optional({ values: "falsy" });
  return [
    req(body("title"), "title")
      .isString().withMessage("title must be a string").bail()
      .trim()
      .isLength({ min: 1, max: 200 }).withMessage("title must be 1-200 characters"),
    req(body("description"), "description")
      .isString().withMessage("description must be a string").bail()
      .isLength({ min: 1, max: 20000 })
      .withMessage("description must be at most 20000 characters"),
    req(body("category"), "category")
      .isString().withMessage("category must be a string").bail()
      .isLength({ min: 1, max: 100 })
      .withMessage("category must be at most 100 characters"),
    body("price")
      .optional({ values: "null" })
      .isFloat({ min: 0 })
      .withMessage("price must be a number >= 0"),
    optionalUrl("thumbnail"),
    optionalUrl("video"),
    ...prerequisitesValidation,
  ];
};

export const createCourseValidation = courseBodyRules(true);
export const updateCourseValidation = [idParam("id"), ...courseBodyRules(false)];

export const courseIdParamValidation = [idParam("id")];
export const courseIdParamNamedValidation = [idParam("courseId")];

export const listCoursesValidation = [
  optionalPositiveInt("page"),
  optionalPositiveInt("limit"),
  query("category")
    .optional({ values: "falsy" })
    .isString()
    .withMessage("category must be a string")
    .bail()
    .isLength({ max: 100 })
    .withMessage("category must be at most 100 characters"),
  query("createdBy")
    .optional({ values: "falsy" })
    .isMongoId()
    .withMessage("createdBy must be a valid id"),
];

// /courses/user: createdBy is required (controller returns 400 without it).
export const coursesByUserValidation = [
  query("createdBy")
    .exists({ values: "falsy" })
    .withMessage("createdBy is required")
    .bail()
    .isMongoId()
    .withMessage("createdBy must be a valid id"),
];

export const recommendedCoursesValidation = [
  body("interests")
    .optional({ values: "null" })
    .isArray({ max: 100 })
    .withMessage("interests must be an array of at most 100 items"),
  body("interests.*")
    .isString()
    .withMessage("each interest must be a string")
    .bail()
    .isLength({ max: 100 })
    .withMessage("each interest must be at most 100 characters"),
];

const reviewBodyRules = (required) => [
  body("rating")
    .if((v) => required || v !== undefined)
    .isInt({ min: 1, max: 5 })
    .withMessage("rating must be an integer between 1 and 5"),
  body("comment")
    .if((v) => required || v !== undefined)
    .isString()
    .withMessage("comment must be a string")
    .bail()
    .isLength({ max: 5000 })
    .withMessage("comment must be at most 5000 characters"),
];

export const createReviewValidation = [idParam("id"), ...reviewBodyRules(true)];
export const updateReviewValidation = [
  idParam("id"),
  param("reviewId").optional().isMongoId().withMessage("reviewId must be a valid id"),
  ...reviewBodyRules(false),
];
export const deleteReviewValidation = [
  idParam("id"),
  param("reviewId").optional().isMongoId().withMessage("reviewId must be a valid id"),
];

export const listReviewsValidation = [
  idParam("id"),
  optionalPositiveInt("page"),
  optionalPositiveInt("limit"),
  query("sort").optional({ values: "falsy" }).isString().withMessage("sort must be a string").isLength({ max: 30 }),
];

export const courseProgressUpdateValidation = [
  idParam("id"),
  body("lessonId").exists({ values: "falsy" }).withMessage("lessonId is required").bail()
    .isMongoId().withMessage("lessonId must be a valid id"),
  body("lastPositionSeconds")
    .optional({ values: "null" })
    .isFloat({ min: 0 })
    .withMessage("lastPositionSeconds must be a number >= 0"),
];

export const purchaseCourseValidation = [
  body("courseId")
    .exists({ values: "falsy" })
    .withMessage("courseId is required")
    .bail()
    .isMongoId()
    .withMessage("courseId must be a valid id"),
];

// Quiz routes: ID params and pagination only (quiz bodies are validated by the
// quiz service).
export const quizIdParamValidation = [idParam("quizId")];
export const attemptIdParamValidation = [idParam("attemptId")];
export const courseQuizzesListValidation = [
  idParam("courseId"),
  optionalPositiveInt("page"),
  optionalPositiveInt("limit"),
];
