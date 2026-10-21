import express from "express"
import { protect } from "../middlewares/authMiddleware.js";
import { validate } from "../../middlewares/validate.js";
import { purchaseCourseValidation } from "../../validators/courseValidators.js";
import { purchaseCourse } from "../controllers/purchaseCourseController.js";

const router = express.Router();

router.post("/course", protect, purchaseCourseValidation, validate, purchaseCourse);


export default router;