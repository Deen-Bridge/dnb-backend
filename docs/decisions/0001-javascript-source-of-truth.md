# ADR 0001: JavaScript (ESM) is the source of truth

- Status: Accepted
- Issue: #397

## Context

The repository contains both `.js` and `.ts` files under `src/`. Verified on `origin/main`:

- 294 tracked `.js` files and 74 tracked `.ts` files under `src/`.
- No `tsconfig.json` exists, and `package.json` has no `typescript`, `tsc`, `ts-node` or `tsx` dependency or script.
- No `.js` file imports a `.ts` file (searched for `from '...ts'` and `require('...ts')`).
- The server runs with plain `node` (`node --import dotenv/config server.js`, `"type": "module"`).
- CI (`.github/workflows/ci.yml`) syntax-checks `*.js` only (`node --check`) and starts `node server.js`. `.ts` files are never compiled, checked or executed.

So the `.ts` files are never loaded at runtime and never validated. 39 of them are duplicates of a `.js` file with the same base name; the other 35 have no `.js` counterpart.

## Decision

The backend is JavaScript (ES modules). `.js` files are the only source of truth. We do not add a TypeScript build or a typecheck step, so a typecheck CI job (#393) is unnecessary.

## Consequences

- New code is written in `.js`. Do not add new `.ts` files.
- The existing `.ts` files are dead code and are removed through the per-feature issues (#398-#407), not in a bulk deletion.
- Reviewers can ignore `.ts` files when judging runtime behavior.
- If TypeScript is wanted later, that needs a new ADR (config, build step, CI) and a planned migration.

## Handling existing `.ts` duplicates

When a feature already has a working `.js` implementation, delete the `.ts` twin; keep the `.js` as is unless it is missing behavior, in which case port that behavior into the `.js` file first. When a feature exists only as `.ts`, it is not running today: either port it to `.js` and wire it in, or delete it, as decided in that feature's issue.

## `.js`/`.ts` duplicate pairs present on main

- `src/controllers/badge.controller` (.js and .ts)
- `src/controllers/certificate.controller` (.js and .ts)
- `src/controllers/course-bundle.controller` (.js and .ts)
- `src/controllers/highlight.controller` (.js and .ts)
- `src/controllers/moderation.controller` (.js and .ts)
- `src/controllers/reading-group.controller` (.js and .ts)
- `src/controllers/space-poll.controller` (.js and .ts)
- `src/middlewares/dateFormatter` (.js and .ts)
- `src/models/UserPreferences` (.js and .ts)
- `src/models/badge.model` (.js and .ts)
- `src/models/certificate.model` (.js and .ts)
- `src/models/content-flag.model` (.js and .ts)
- `src/models/course-bundle.model` (.js and .ts)
- `src/models/highlight.model` (.js and .ts)
- `src/models/moderation-action.model` (.js and .ts)
- `src/models/note.model` (.js and .ts)
- `src/models/poll-vote.model` (.js and .ts)
- `src/models/reading-group-member.model` (.js and .ts)
- `src/models/reading-group.model` (.js and .ts)
- `src/models/space-poll.model` (.js and .ts)
- `src/models/user-badge.model` (.js and .ts)
- `src/routes/api/users/completion` (.js and .ts)
- `src/routes/api/users/preferences` (.js and .ts)
- `src/routes/badge.routes` (.js and .ts)
- `src/routes/certificate.routes` (.js and .ts)
- `src/routes/course-bundle.routes` (.js and .ts)
- `src/services/badge.service` (.js and .ts)
- `src/services/certificate.service` (.js and .ts)
- `src/services/course-bundle.service` (.js and .ts)
- `src/services/highlight.service` (.js and .ts)
- `src/services/moderation.service` (.js and .ts)
- `src/services/reading-group.service` (.js and .ts)
- `src/services/space-poll.service` (.js and .ts)
- `src/sockets/preferences.socket` (.js and .ts)
- `src/sockets/space-poll.socket` (.js and .ts)
- `src/templates/certificate.template` (.js and .ts)
- `src/utils/badge-criteria` (.js and .ts)
- `src/utils/hijriCalendar` (.js and .ts)
- `src/utils/profileCompletion` (.js and .ts)

Paths are listed without extension; both extensions exist.
