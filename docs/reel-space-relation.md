# Reel-to-space relation decision

`Reel` currently has no `spaceId` (or equivalent) field, and the backend has
no route or production caller that establishes reels as space content. The
canonical relation is therefore **not implemented** at this time.

`ReelRepository.findBySpace` is retained as a compatibility guard, but it now
raises `RELATION_UNSUPPORTED` with HTTP status `501`. It must not return an
empty array or empty page, because that would incorrectly claim that a valid
space has no reels. Callers should remove the query or surface the unsupported
capability explicitly.

If spaces later become a supported reel context, the implementation must be
introduced as one contract: add an optional `spaceId` reference and compound
index to the Reel schema, define the creator/space authorization rule, migrate
or backfill existing data, add a space-scoped route, and replace the guard with
an indexed paginated query. The rollout should first deploy the schema and
read-path compatibility, verify counts and ownership on a sample of spaces,
then enable writes. Roll back by disabling writes and retaining the explicit
unsupported response; do not silently fall back to an empty result.
