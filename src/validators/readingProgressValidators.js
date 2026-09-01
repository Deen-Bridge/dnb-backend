// validators/readingProgressValidators.js
import { body, param } from "express-validator";
import mongoose from "mongoose";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const bookIdParam = param("bookId")
  .custom(isValidObjectId)
  .withMessage("A valid book id is required");

/**
 * Validation for updating reading progress. Requires at least one of
 * page / percentage / lastPosition, and bounds the numeric fields
 * (percentage 0-100, page >= 0).
 */
export const updateReadingProgressValidation = [
  bookIdParam,
  body("percentage")
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 100 })
    .withMessage("percentage must be a number between 0 and 100"),
  body("page")
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage("page must be an integer >= 0"),
  body("totalPages")
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage("totalPages must be an integer >= 0"),
  body("lastPosition")
    .optional({ nullable: true })
    .isString()
    .withMessage("lastPosition must be a string"),
  body("audioPositionSeconds")
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage("audioPositionSeconds must be a number >= 0"),
  body("audioDuration")
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage("audioDuration must be a number >= 0"),
  body("device")
    .optional({ nullable: true })
    .isString()
    .withMessage("device must be a string"),
  body().custom((value) => {
    if (
      (value.page === undefined || value.page === null) &&
      (value.percentage === undefined || value.percentage === null) &&
      (value.lastPosition === undefined || value.lastPosition === null) &&
      (value.audioPositionSeconds === undefined || value.audioPositionSeconds === null)
    ) {
      throw new Error("Provide at least one of page, percentage, lastPosition or audioPositionSeconds");
    }
    return true;
  }),
];

export const readingProgressBookIdValidation = [bookIdParam];
