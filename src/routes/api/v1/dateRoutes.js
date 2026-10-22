import express from "express";
import { convertDate } from "../../../controllers/dateController.js";
import dateFormatterMiddleware from "../../../middlewares/dateFormatter.js";

const router = express.Router();

router.use(dateFormatterMiddleware);

router.get("/convert", convertDate);

export default router;
