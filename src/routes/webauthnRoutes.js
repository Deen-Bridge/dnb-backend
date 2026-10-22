import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { createChallenge, listCredentials, registerCredential } from "../services/webauthn.js";

const router = express.Router();

router.get("/challenge", protect, (_req, res) => res.json({ challenge: createChallenge() }));
router.get("/credentials", protect, async (req, res, next) => {
  try { res.json({ credentials: await listCredentials(req.user._id) }); } catch (error) { next(error); }
});
router.post("/credentials", protect, async (req, res, next) => {
  try {
    const { credentialId, publicKey, counter, transports } = req.body;
    if (!credentialId || !publicKey) return res.status(400).json({ message: "credentialId and publicKey are required" });
    const credential = await registerCredential({ userId: req.user._id, credentialId, publicKey, counter, transports });
    res.status(201).json({ credential: { id: credential.id, credentialId: credential.credentialId } });
  } catch (error) { next(error); }
});

export default router;
