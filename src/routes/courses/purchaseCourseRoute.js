import express from "express"
import { protect } from "../middlewares/authMiddleware.js";
import { purchaseCourse } from "../controllers/purchaseCourseController.js";

const router = express.Router();

router.post("/course", protect, purchaseCourse);


export default router;