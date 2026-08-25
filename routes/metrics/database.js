// Thin re-export shim so the route is reachable at both `routes/metrics/...`
// and `src/routes/metrics/...`, mirroring the `routes/health/database.js`
// convention already used in this repo. The real implementation lives under
// `src/routes/metrics/database.js`.
export { default } from "../../src/routes/metrics/database.js";
