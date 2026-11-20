import crypto from "crypto";
import IdempotencyKey from "../models/IdempotencyKey.js";
import { APIError, catchAsync } from "./errorHandler.js";
import logger from "../config/logger.js";

/**
 * Middleware to enforce request-level idempotency on mutating endpoints.
 *
 * @param {Object} options
 * @param {boolean} [options.required=false] - Whether the Idempotency-Key header is mandatory for the route.
 */
export const idempotency = ({ required = false } = {}) => {
  return catchAsync(async (req, res, next) => {
    const rawKey =
      req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (!idempotencyKey || !idempotencyKey.trim()) {
      if (required) {
        throw new APIError("Idempotency-Key header is required", 400);
      }
      return next();
    }

    const trimmedKey = idempotencyKey.trim();
    if (trimmedKey.length > 255) throw new APIError("Idempotency key is too long", 400);
    const userId = req.user?._id;
    if (!userId) {
      throw new APIError("Authentication required for idempotency protection", 401);
    }

    const endpoint = (req.originalUrl || req.path || "").split("?")[0];
    const normalize = (value) => {
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === "object") return Object.keys(value).sort().reduce((out, key) => { out[key] = normalize(value[key]); return out; }, {});
      return value;
    };
    const operation = `${req.method}:${(req.originalUrl || req.path || "").split("?")[0]}`;
    const scope = crypto.createHash("sha256").update(String(req.body?.wallet || req.body?.walletAddress || userId)).digest("hex");
    const requestHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ operation, scope, body: normalize(req.body || {}) }))
      .digest("hex");

    let record;
    try {
      record = await IdempotencyKey.create({
        key: trimmedKey,
        userId,
        endpoint,
        operation,
        scope,
        requestHash,
        status: "in_progress",
      });
    } catch (err) {
      if (err.code === 11000) {
        const existing = await IdempotencyKey.findOne({ key: trimmedKey });

        if (!existing) {
          throw err;
        }

        if (String(existing.userId) !== String(userId) || existing.operation !== operation || existing.scope !== scope) {
          throw new APIError("Idempotency key is already bound to another operation", 409);
        }
        if (existing.requestHash !== requestHash) {
          throw new APIError("Idempotency key payload mismatch", 422);
        }

        if (existing.status === "in_progress") {
          if (Date.now() - new Date(existing.createdAt).getTime() > 5 * 60 * 1000) {
            await IdempotencyKey.deleteOne({ _id: existing._id, status: "in_progress" });
            return idempotency({ required })(req, res, next);
          } else {
          throw new APIError(
            "A request with this idempotency key is currently in progress",
            409
          );
          }
        }

        if (existing.status === "completed") {
          return res.status(existing.statusCode).json(existing.responseBody);
        }
      }
      throw err;
    }

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let captured = false;

    const captureResponse = (body) => {
      if (captured) return;
      captured = true;
      const statusCode = res.statusCode || 200;

      if (statusCode >= 500 || statusCode < 200 || Buffer.byteLength(JSON.stringify(body ?? null), "utf8") > 64 * 1024) {
        IdempotencyKey.deleteOne({ _id: record._id }).catch((e) =>
          logger.error({ err: e }, "Failed to delete idempotency key on server error")
        );
      } else {
        IdempotencyKey.updateOne(
          { _id: record._id },
          {
            $set: {
              status: "completed",
              statusCode,
              responseBody: body,
            },
          }
        ).catch((e) =>
          logger.error({ err: e }, "Failed to update idempotency key to completed")
        );
      }
    };

    res.json = function (body) {
      captureResponse(body);
      return originalJson(body);
    };

    res.send = function (body) {
      if (!captured) {
        let parsed = body;
        if (typeof body === "string") {
          try {
            parsed = JSON.parse(body);
          } catch (_) {}
        }
        captureResponse(parsed);
      }
      return originalSend(body);
    };

    res.on("close", () => {
      if (!captured && !res.writableEnded) {
        IdempotencyKey.deleteOne({ _id: record._id }).catch(() => {});
      }
    });

    next();
  });
};

export default idempotency;
