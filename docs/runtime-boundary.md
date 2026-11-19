# Runtime boundary

The backend currently runs as a native Node.js ESM application. `app.js`,
`server.js`, the test runner, and the production start command import the
`.js` implementation paths. There is no TypeScript compiler or loader in the
runtime configuration, so `.ts` files under `src/` are not mounted or tested
by the production process.

The duplicate paths listed in [`runtime-boundary.json`](./runtime-boundary.json)
are therefore intentional TypeScript staging copies. Their JavaScript
counterparts are authoritative until a deliberate TypeScript migration adds a
compiler, changes the runtime entrypoint, and migrates the corresponding tests.
The inventory is explicit so each pair has a disposition rather than relying
on filename convention.

Run `npm run audit:runtime-boundary` to verify the inventory. The check fails
when a new `.js`/`.ts` pair appears without a disposition, or when an
inventoried pair is removed or renamed without updating the migration plan.
