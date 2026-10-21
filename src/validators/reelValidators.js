// validators/reelValidators.js
import { body, param, query } from "express-validator";
import mongoose from "mongoose";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const reelIdParam = param("id")
  .custom(isValidObjectId)
  .withMessage("A valid reel id is required");

// Create a duet/stitch response for the reel identified by :id.
// Note: this runs *after* multer (upload.single), so multipart text fields are
// available on req.body.
export const createReelDuetValidation = [
  reelIdParam,
  body("description")
    .exists({ values: "null" })
    .withMessage("Description is required")
    .bail()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Description is required"),
  body("type")
    .exists({ values: "null" })
    .withMessage("type is required")
    .bail()
    .isIn(["duet", "stitch"])
    .withMessage("type must be one of: duet, stitch"),
  body("stitchStart")
    .if(body("type").equals("stitch"))
    .exists({ values: "null" })
    .withMessage("stitchStart is required for a stitch")
    .bail()
    .isFloat({ min: 0 })
    .withMessage("stitchStart must be a number >= 0"),
  body("stitchEnd")
    .if(body("type").equals("stitch"))
    .exists({ values: "null" })
    .withMessage("stitchEnd is required for a stitch")
    .bail()
    .isFloat({ gt: 0 })
    .withMessage("stitchEnd must be a number > 0")
    .bail()
    .custom((value, { req }) => {
      if (Number(value) <= Number(req.body.stitchStart)) {
        throw new Error("stitchEnd must be greater than stitchStart");
      }
      return true;
    }),
];

// Browse duets/stitches for the reel identified by :id.
export const listReelDuetsValidation = [
  reelIdParam,
  query("type")
    .optional({ values: "falsy" })
    .isIn(["duet", "stitch"])
    .withMessage("type must be one of: duet, stitch"),
  query("page")
    .optional({ values: "falsy" })
    .isInt({ min: 1 })
    .withMessage("page must be a positive integer"),
  query("limit")
    .optional({ values: "falsy" })
    .isInt({ min: 1, max: 50 })
    .withMessage("limit must be between 1 and 50"),
];

const objectIdParam = (name) =>
  param(name).custom(isValidObjectId).withMessage(`A valid ${name} is required`);

const paginationQuery = (maxLimit) => [
  query("page")
    .optional({ values: "falsy" })
    .isInt({ min: 1 })
    .withMessage("page must be a positive integer"),
  query("limit")
    .optional({ values: "falsy" })
    .isInt({ min: 1, max: maxLimit })
    .withMessage(`limit must be between 1 and ${maxLimit}`),
];

// Only the :id param (share / view / get-by-id).
export const reelIdValidation = [reelIdParam];

export const listReelsValidation = paginationQuery(100);

export const createReelValidation = [
  body("description")
    .exists({ values: "null" })
    .withMessage("Description is required")
    .bail()
    .isString()
    .withMessage("Description must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Description is required")
    .bail()
    .isLength({ max: 2000 })
    .withMessage("Description must be at most 2000 characters"),
  body("category")
    .optional({ values: "falsy" })
    .isString()
    .withMessage("category must be a string")
    .bail()
    .isLength({ max: 100 })
    .withMessage("category must be at most 100 characters"),
  // tags: comma separated string or array of strings (see normalizeTags)
  body("tags")
    .optional({ values: "falsy" })
    .custom(
      (value) =>
        typeof value === "string" ||
        (Array.isArray(value) && value.every((t) => typeof t === "string"))
    )
    .withMessage("tags must be a string or an array of strings"),
];

export const reactToReelValidation = [
  reelIdParam,
  body("type")
    .isIn(["like", "love"])
    .withMessage("Reaction type must be either 'like' or 'love'"),
];

export const addReelCommentValidation = [
  reelIdParam,
  body("text")
    .exists({ values: "null" })
    .withMessage("Comment text is required")
    .bail()
    .isString()
    .withMessage("Comment text must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Comment text is required")
    .bail()
    .isLength({ max: 2000 })
    .withMessage("Comment text must be at most 2000 characters"),
];

export const listReelCommentsValidation = [
  reelIdParam,
  ...paginationQuery(100),
];

export const deleteReelCommentValidation = [
  reelIdParam,
  objectIdParam("commentId"),
];

export const flagReelValidation = [
  objectIdParam("reelId"),
  body("reason")
    .exists({ values: "null" })
    .withMessage("Reason for flagging is required")
    .bail()
    .isString()
    .withMessage("reason must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Reason for flagging is required")
    .bail()
    .isLength({ max: 200 })
    .withMessage("reason must be at most 200 characters"),
  body("details")
    .optional({ values: "null" })
    .isString()
    .withMessage("details must be a string")
    .bail()
    .isLength({ max: 2000 })
    .withMessage("details must be at most 2000 characters"),
];

export default {
  createReelDuetValidation,
  listReelDuetsValidation,
  reelIdValidation,
  listReelsValidation,
  createReelValidation,
  reactToReelValidation,
  addReelCommentValidation,
  listReelCommentsValidation,
  deleteReelCommentValidation,
  flagReelValidation,
};
