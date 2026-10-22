import { Request, Response, NextFunction } from "express";
import { assignVariant } from "../../services/analytics/ab-testing-service.js";
import crypto from "crypto";

/**
 * Middleware factory for assigning and attaching experiment variants to req.
 */
export const variantAssignmentMiddleware = (experimentKey: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId =
        req.headers["x-session-id"] ||
        (req as any).cookies?.sessionId ||
        (req as any).user?._id?.toString() ||
        crypto.randomUUID();

      const userId = (req as any).user?._id?.toString() || null;

      const variant = await assignVariant(experimentKey, String(sessionId), userId);

      if (!(req as any).experiments) {
        (req as any).experiments = {};
      }
      (req as any).experiments[experimentKey] = variant;

      res.setHeader(`X-Experiment-${experimentKey}`, variant || "control");

      next();
    } catch (error) {
      next();
    }
  };
};

export default variantAssignmentMiddleware;
