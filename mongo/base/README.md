# Base classes for the /mongo repository layer live here.

`BaseRepository` (CRUD, offset & cursor pagination, standardized errors) is
added by its own refactor — see Deen-Bridge/dnb-backend#168 — and will be
re-exported from `mongo/index.js` as part of the `base` namespace.
