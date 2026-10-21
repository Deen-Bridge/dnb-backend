import { body, param, query } from "express-validator";
import mongoose from "mongoose";

const objectId = (field) =>
  field.custom((value) => mongoose.Types.ObjectId.isValid(value)).withMessage("Must be a valid id");

export const createReadingGroupValidation = [
  body("name").isString().trim().isLength({ min: 1, max: 120 }).withMessage("name must be 1-120 characters"),
  body("bookId").isMongoId().withMessage("bookId must be a valid id"),
  body("description").optional().isString().isLength({ max: 2000 }),
  body("privacy").optional().isIn(["public", "private"]),
  body("chaptersPerWeek").optional().isInt({ min: 1, max: 52 }),
];

export const readingGroupIdValidation = [objectId(param("id"))];
export const inviteMemberValidation = [body("targetUserId").isMongoId()];
export const discussionValidation = [
  body("chapter").isInt({ min: 0 }),
  body("content").isString().trim().isLength({ min: 1, max: 5000 }),
];
export const progressValidation = [
  body("chapter").optional().isInt({ min: 0 }),
  body("progress").optional().isFloat({ min: 0, max: 100 }),
];
export const readingGroupQueryValidation = [
  query("bookId").optional().isMongoId(),
  query("privacy").optional().isIn(["public", "private"]),
];
