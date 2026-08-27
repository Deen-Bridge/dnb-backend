// routes/docsRoutes.js — Issue #224
/**
 * Documentation portal routes.
 *
 * Serves the Redoc-powered interactive API documentation at /docs.
 *
 * Endpoints:
 *   GET /docs          — renders docs/portal/index.html (Redoc SPA)
 *   GET /docs/spec     — serves openapi.yaml (fetched by Redoc at runtime)
 *   GET /docs/guides/* — serves static guide markdown / HTML files
 */
import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const PORTAL_DIR = path.join(REPO_ROOT, "docs", "portal");
const SPEC_PATH = path.join(REPO_ROOT, "openapi.yaml");
const GUIDES_DIR = path.join(PORTAL_DIR, "guides");

const router = Router();

/**
 * GET /docs
 * Serves the Redoc single-page documentation portal.
 */
router.get("/", (req, res) => {
  res.sendFile(path.join(PORTAL_DIR, "index.html"));
});

/**
 * GET /docs/spec
 * Serves the raw openapi.yaml for Redoc to consume.
 * Setting the correct Content-Type allows Redoc to parse it without bundling.
 */
router.get("/spec", (req, res) => {
  res.setHeader("Content-Type", "application/yaml");
  res.sendFile(SPEC_PATH);
});

/**
 * GET /docs/guides/*
 * Serves additional guide documents from docs/portal/guides/.
 */
router.use("/guides", (req, res, next) => {
  res.sendFile(path.join(GUIDES_DIR, req.path), (err) => {
    if (err) next(err);
  });
});

export default router;
