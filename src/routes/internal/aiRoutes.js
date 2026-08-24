// routes/internal/aiRoutes.js
//
// Internal, service-to-service routes callable ONLY by the AI service (dnb-ai)
// over the signed-request channel. Every route here is guarded by
// requireServiceAuth with an explicit scope — there is no end-user JWT path in.
// See docs/service-to-service-auth.md for the signing contract.
import express from "express";
import { requireServiceAuth } from "../../middlewares/serviceAuth.js";

const router = express.Router();

// GET /api/internal/ai/whoami
// Reflects the authenticated service identity — a genuine, mountable endpoint a
// reviewer (or the dnb-ai client) can hit to confirm its credentials work.
router.get(
  "/whoami",
  requireServiceAuth({ scope: "ai:read-content" }),
  (req, res) => {
    res.json({
      success: true,
      service: req.service,
      timestamp: new Date().toISOString(),
    });
  }
);

export default router;
