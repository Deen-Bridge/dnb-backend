# Experiment endpoint threat model

The public assignment and conversion endpoints support anonymous experimentation, but they are not an attribution authority.

## Identity

- Authenticated requests may attribute only to the authenticated user's ID. A different `userId` is rejected.
- Anonymous callers receive a signed, server-issued `sessionId` in the assignment response. The token is HMAC-protected, expires after 30 days, and is the only accepted anonymous identifier.
- The server no longer falls back to an IP address or accepts arbitrary caller-controlled session strings.

## Input and abuse limits

- Experiment keys are limited to 100 characters and a safe identifier grammar.
- Metric names are limited to 64 characters and a safe identifier grammar.
- Conversion values must be finite and within +/-1,000,000,000.
- Metadata must be a JSON object no larger than 8 KB.
- Event IDs are bounded to 128 characters and safe identifier characters.
- Assignment and conversion requests are limited to 60 per IP per minute. This in-process limiter is a first-line control; production deployments should also enforce a shared gateway limit.

## Metric integrity

Conversions use a unique dedupe key composed of experiment, identity, metric, and event ID. Without an event ID, the identity can record one conversion for a metric. Retries therefore do not inflate the metric.

## Review and rollout checklist

1. Add or review an index for every new experiment filter and sort shape.
2. Verify the query plan with `explain("executionStats")` against a representative dataset before rollout.
3. Load-test anonymous and authenticated traffic, including concurrent conversion retries.
4. Roll out the unique conversion index after confirming legacy conversion records have a dedupe key; roll back by removing the index only with metric-integrity approval.
