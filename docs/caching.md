# Redis Caching

This documents which endpoints are cached, their TTLs, and the invalidation
strategy. The underlying helpers live in `src/utils/cache.js` (Redis
primitives, `CACHE_TTL`/`CACHE_KEYS` presets) and `src/middlewares/cache.js`
(`cacheMiddleware`, `smartCache`, `invalidateCacheMiddleware`).

All caching degrades gracefully: `getCache`/`setCache`/`deleteCachePattern`
check `isRedisReady()` first and no-op (falling through to Mongo) when Redis
is unavailable, so a down Redis instance never breaks a request.

## Cached read endpoints

| Endpoint | Cache key | TTL | Notes |
|---|---|---|---|
| `GET /api/books` | `books:list` | 15 min (`CACHE_TTL.BOOKS`) |  |
| `GET /api/books/:id` | `book:<id>` | 15 min |  |
| `GET /api/books/by-author/:authorId` | `books:author:<authorId>` | 15 min |  |
| `GET /api/books/recom` | `books:recommended` | 3 min (`CACHE_TTL.SHORT`) | shared key regardless of `interests`; the controller (`fetchRecommendedBooks`) also has a pre-existing bug (undefined `category` reference) that makes it non-functional today - out of scope here |
| `POST /api/books/recommended` | `books:recommended:<sorted interests \| "popular">` | 15 min (`CACHE_TTL.BOOKS`) | added in this change; keyed explicitly in the controller since `cacheMiddleware` only intercepts GET |
| `GET /api/courses` | `courses:list` | 15 min (`CACHE_TTL.COURSES`) |  |
| `GET /api/courses/:id` | `course:<id>` | 15 min |  |
| `GET /api/courses/user` | `courses:user:<createdBy>` | 15 min |  |
| `POST /api/courses/recommended` | `courses:recommended:<sorted interests \| "none">` | 15 min (`CACHE_TTL.COURSES`) | added in this change; previously explicitly left uncached ("POST routes not cached") |
| `GET /api/spaces` | `spaces:list` | 5 min (`CACHE_TTL.SPACES`) |  |
| `GET /api/spaces/:id` | `space:<id>` | 5 min |  |
| `GET /api/spaces/by-host/:hostId` | `spaces:host:<hostId>` | 5 min |  |
| `GET /api/search` | `search:<type>:<q>` | 5 min (`CACHE_TTL.SEARCH`) |  |
| `GET /api/users/:id` | `user:<id>` | 10 min (`CACHE_TTL.USERS`) |  |
| `GET /api/users/recommendations` | `user:<requester id>:recommendations` | 10 min | keyed per requesting user |
| `GET /api/users/:userId/followers` | `user:<userId>:followers` | 10 min |  |
| `GET /api/users/:userId/following` | `user:<userId>:following` | 10 min |  |

The books/courses/spaces/search/users list and detail endpoints above were
wired up separately (see `feat: configure Redis cache layer for production
use`, merged to `main`). This change adds the two `POST /recommended`
entries, which that work left uncached, plus this document.

## Invalidation

Writes call `invalidateCacheMiddleware` with wildcard patterns so a create,
update, delete, or review clears the relevant cached list/detail entries
(`deleteCachePattern` runs a Redis `KEYS` scan against the pattern):

- Books: `createBook` invalidates `books:*`; `deleteBook` and `addBookReview` invalidate `books:*` and `book:*`.
- Courses: `createCourse` invalidates `courses:*`; `enrollInCourse`/`addCourseReview` invalidate `course:*`; `updateCourse` invalidates `courses:*` and `course:*`.
- Spaces: `createSpace` invalidates `spaces:*`; `joinWaitList` invalidates `space:*`; `updateSpace`/`deleteSpace` invalidate `spaces:*` and `space:*`.
- Users: profile/follow writes invalidate `user:*` (and `user:*:followers` / `user:*:following` on follow/unfollow).

`books:*` and `courses:*` also cover the new `books:recommended:*` /
`courses:recommended:*` keys added in this change, since they share the same
prefix - no separate invalidation wiring was needed for them.

Search has no dedicated invalidation hook (it spans five collections); its
5-minute TTL is the staleness bound instead.

## Deliberately not cached

- **Bookmarks** (`GET /api/books/bookmarks`, `GET /api/courses/bookmarks`,
  and the `bookmark/check` routes) are per-user and are left uncached rather
  than risk leaking one user's bookmark state into another user's response
  under a shared key.
- **Reels** (`GET /api/reels`, `GET /api/reels/:id`) embed the requesting
  user's `viewerState` (liked/loved) directly in each reel object. Caching
  the response as-is would leak one viewer's like/love state to every other
  viewer who hits the same cache key, so these are left uncached until the
  response shape separates viewer-specific state from the shared reel data.

## User-specific data

`cacheMiddleware`/`smartCache` support a per-request key generator (and
`smartCache`'s `includeUser` option) for endpoints that must vary per user -
see `GET /api/users/recommendations` above, which folds the requester's id
into the key. Any future authenticated, user-specific GET endpoint should do
the same rather than caching under a shared key.
