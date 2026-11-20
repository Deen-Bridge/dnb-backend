# Client-safe error handling

The API error middleware has one public contract for every failure:

```json
{
  "success": false,
  "status": "fail|error",
  "message": "Client-safe message",
  "data": null,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Client-safe message"
  },
  "reqId": "correlation-id"
}
```

`reqId` is included when the request has an application request ID or an
`X-Request-ID` header. Clients must use it when contacting support; it is not
a substitute for an authentication token.

## Safety rules

- Database values, query fragments, provider payloads, token material, and
  stack traces never appear in client responses.
- Duplicate-key, cast, malformed-validation, provider, and unknown errors are
  translated defensively. Missing or malformed driver metadata must not make
  the error handler throw a second error.
- Validation details contain only a bounded, sanitized field name and the
  generic message `Invalid value.`
- Only `NODE_ENV=development` together with the explicit
  `EXPOSE_ERROR_DETAILS=true` setting enables additional diagnostic logging.
  Debug output is still never serialized into the client response.
- Operator diagnostics belong in the structured application logs, keyed by
  `event=api_error`, `correlationId`, `code`, and `statusCode`. Logging
  transports must retain the configured redaction rules.

## Middleware behavior

Handlers should use `catchAsync` so both rejected promises and synchronous
throws reach the single error middleware. If a response has already started,
the middleware delegates to Express rather than attempting a second response.
