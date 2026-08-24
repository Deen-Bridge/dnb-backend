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
    const userId = req.user?._id;
    if (!userId) {
      throw new APIError("Authentication required for idempotency protection", 401);
    }

    const endpoint = (req.originalUrl || req.path || "").split("?")[0];
    const requestHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(req.body || {}))
      .digest("hex");

    let record;
    try {
      record = await IdempotencyKey.create({
        key: trimmedKey,
        userId,
        endpoint,
        requestHash,
        status: "in_progress",
      });
    } catch (err) {
      if (err.code === 11000) {
        const existing = await IdempotencyKey.findOne({
          key: trimmedKey,
          userId,
          endpoint,
        });

        if (!existing) {
          throw err;
        }

        if (existing.requestHash !== requestHash) {
          throw new APIError("Idempotency key payload mismatch", 422);
        }

        if (existing.status === "in_progress") {
          throw new APIError(
            "A request with this idempotency key is currently in progress",
            409
          );
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

      if (statusCode >= 500) {
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
