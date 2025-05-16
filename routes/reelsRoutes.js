import express from "express";
import { getReels, createReel } from "../controllers/reelController.js";

const router = express.Router();

router.get("/", getReels);
router.post("/", createReel);

export default router;