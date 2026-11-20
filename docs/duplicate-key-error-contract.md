# Duplicate-key error contract

Unique-index violations from MongoDB always return the conflict error code and
HTTP 409 with the stable message: A record with these values already exists.
The response does not include index names, field values, collection names, or
raw driver text.

The handler accepts driver error variants defensively and never assumes that
errmsg, message, or keyValue is present. Operators can correlate the structured
server log with the request ID without exposing database metadata to clients.
