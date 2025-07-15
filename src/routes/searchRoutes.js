import express from "express";
import { searchAll } from "../controllers/searchController.js";

const router = express.Router();

// Main search endpoint
router.get("/", searchAll);

export default router;
