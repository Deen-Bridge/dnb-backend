import express from "express";
import { buildStellarToml } from "../services/stellar/stellarTomlService.js";

const router = express.Router();

router.get("/stellar.toml", (req, res) => {
  // SEP-1 mandates CORS * and text/toml content type
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Content-Type", "text/toml; charset=utf-8");
  // Cache for 5 minutes — values are env-derived and rarely change at runtime
  res.set("Cache-Control", "public, max-age=300");
  res.status(200).send(buildStellarToml());
});

export default router;
