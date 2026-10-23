# TypeScript migration boundary

The backend currently runs JavaScript and does not claim to typecheck the
orphaned TypeScript modules. TypeScript adoption should be introduced as a
separate migration with an explicit `tsconfig`, an executable `typecheck`
script, and CI coverage. Until then, runtime changes belong in the JavaScript
modules used by `server.js`.
