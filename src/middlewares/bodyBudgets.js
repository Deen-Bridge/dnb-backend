import express from "express";

// Keep the default request surface small. Routes with a documented reason to
// accept larger JSON bodies opt in before the default parser is installed.
export const BODY_LIMITS = Object.freeze({
  defaultJson: "100kb",
  defaultUrlencoded: "100kb",
  cspReport: "10kb",
  analyticsEvent: "256kb",
  providerWebhook: "256kb",
  serviceRequest: "1mb",
});

export const captureRawBody = (req, _res, buf) => {
  req.rawBody = buf;
};

export const jsonBodyParser = (limit, options = {}) =>
  express.json({
    limit,
    verify: captureRawBody,
    ...options,
  });

export const urlencodedBodyParser = (limit) =>
  express.urlencoded({ extended: true, limit });
