# Financial report export contract

The financial report endpoint currently supports JSON only. Requests for PDF
or any other format fail before report generation with HTTP 400 and the stable
code UNSUPPORTED_REPORT_FORMAT. This avoids advertising an expensive,
unimplemented export and keeps the API contract honest.

PDF can be reintroduced only with an authenticated, bounded, deterministic
renderer and coverage for date scope, tenant scope, content headers, and
maximum output size.
