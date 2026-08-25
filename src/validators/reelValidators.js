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

export default {
  createReelDuetValidation,
  listReelDuetsValidation,
};
