# Request body budgets

The API uses route-class budgets instead of a single permissive body-parser
limit:

| Route class | JSON budget | Reason |
| --- | ---: | --- |
| Default API routes | 100 KB | Normal auth, CRUD, payment, and mutation payloads |
| CSP reports | 10 KB | Browser reports contain a small fixed set of fields |
| Analytics event ingestion | 256 KB | Bounded client batches |
| Onramp provider webhook | 256 KB | Provider event envelope and metadata |
| Internal service requests | 1 MB | Service-to-service requests may include bounded documents |
| Multipart uploads | Route-specific Multer limits | File size is enforced by the upload middleware |

The route-specific parsers are installed before the 100 KB defaults so a
larger approved route is parsed by its own budget. New endpoints should use the
smallest route-class budget that fits their schema and should add a focused
parser when they genuinely need a different limit. A request that exceeds its
budget is rejected before controller code runs.

## Review checklist

- Define the maximum serialized body size from the endpoint schema.
- Prefer pagination or object storage for large collections and files.
- Keep multipart limits in the route's Multer configuration.
- Add a focused parser before the defaults in app.js for a new payload class.
- Preserve req.rawBody when a signature or HMAC verifier needs exact bytes.
- Add a regression test for the selected budget and update this table.

Deployments should roll out the budget change behind normal CI and health
checks. If a legitimate client is rejected, identify the route and payload
class, add the smallest justified route-specific budget, and redeploy; do not
raise the global default.
