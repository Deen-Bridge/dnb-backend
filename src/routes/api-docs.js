import express from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec, swaggerUiOptions } from "../config/swagger.js";

const router = express.Router();

router.use("/", swaggerUi.serve);
router.get("/", swaggerUi.setup(swaggerSpec, swaggerUiOptions));

export default router;
