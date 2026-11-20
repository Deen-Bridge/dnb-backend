# Request correlation

The API generates an opaque UUID for every request unless the incoming
`X-Request-Id` value is a bounded ASCII identifier (`A-Z`, `a-z`, `0-9`, `.`,
`_`, `:`, or `-`, up to 128 characters). Invalid values are replaced. The
accepted identifier is returned in the response header and is available as
`req.id` and `req.log` for downstream work.

Request completion logs use structured `service`, `route`, `operation`,
`status`, `outcome`, `durationMs`, and `reqId` fields. Pino's centralized
redaction policy must be extended whenever a new sensitive field is logged;
request bodies, authorization headers, cookies, tokens, emails, wallet data,
and provider responses are not log-safe by default.

Operators should use the response `X-Request-Id` to search logs, then limit
exported records to the incident window and authorized responders. Do not
export raw request bodies or credentials. Production log retention and access
must follow the deployment's configured policy.
