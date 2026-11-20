import type { NextFunction, Request, Response } from "express";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

export const experimentRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now();
  const key = String(req.ip || req.socket.remoteAddress || "unknown");
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
    res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
    return res.status(429).json({ success: false, message: "Too many experiment requests" });
  }
  return next();
};
