# Authorization Matrix — Resource Ownership

This document describes the centralized resource-ownership authorization layer
(`src/middlewares/authorize.js`) that guards every mutating endpoint for books,
courses, spaces, and reviews.

## How it works

- `protect` authenticates the request and sets `req.user` (full User doc).
- `authorizeOwnership({ model, ownerField, resourceType })` loads the target
  resource, then allows the request only if the caller is the **owner** or an
  **admin**. On success it attaches the loaded doc as `req.resource`.
- `authorizeReviewOwnership({ model })` loads the parent item (Book/Course) and
  the target review subdocument, applying the same owner-or-admin rule to
  `review.user`. It supports both the id-scoped route (`/:id/reviews/:reviewId`)
  and the self-scoped route (`/:id/reviews`, which targets the caller's own
  review).
- Every denial writes an audit row (`authz.ownership.denied`,
  `status: "failure"`) via the fire-and-forget audit service, then returns
  `403` through the global error handler.

## Owner fields

| Resource | Model    | Owner field        |
| -------- | -------- | ------------------ |
| Book     | `Book`   | `author`           |
| Course   | `Course` | `createdBy`        |
| Space    | `Space`  | `host`             |
| Review   | subdoc   | `reviews[].user`   |

## Expected status codes

Legend: **owner** = the resource owner; **non-owner educator/mentor** = an
authenticated mentor who does not own the resource; **student** = an
authenticated non-owner student; **admin** = any admin.

| Resource / Action                     | Owner | Non-owner educator/mentor | Student (non-owner) | Admin | Non-existent id |
| ------------------------------------- | ----- | ------------------------- | ------------------- | ----- | --------------- |
| Book — `DELETE /:id`                  | 2xx   | 403                       | 403                 | 2xx   | 404             |
| Course — `PUT /:id`                   | 2xx   | 403                       | 403                 | 2xx   | 404             |
| Space — `PUT /update/:id`             | 2xx   | 403                       | 403                 | 2xx   | 404             |
| Space — `DELETE /:id`                 | 2xx   | 403                       | 403                 | 2xx   | 404             |
| Book review — `PUT/PATCH /:id/reviews[/:reviewId]`   | 2xx   | 403                       | 403                 | 2xx   | 404             |
| Book review — `DELETE /:id/reviews[/:reviewId]`      | 2xx   | 403                       | 403                 | 2xx   | 404             |
| Course review — `PUT/PATCH /:id/reviews[/:reviewId]` | 2xx   | 403                       | 403                 | 2xx   | 404             |
| Course review — `DELETE /:id/reviews[/:reviewId]`    | 2xx   | 403                       | 403                 | 2xx   | 404             |

Notes on review status codes:

- On the **self-scoped** review routes (no `:reviewId`), a non-owner has no
  review of their own to act on, so the guard returns **404** ("Review not
  found") rather than 403 — there is no target subdocument to deny.
- On the **id-scoped** review routes (`/:reviewId`), acting on another user's
  review returns **403**; an unknown `:reviewId` returns **404**.

## Out of scope / notes

- **Review CREATE** (`POST /:id/reviews`) is **purchase-gated** (entitlement /
  verified-purchase check in `verifyItemPurchase`), not ownership-gated. It is
  intentionally NOT wrapped by the ownership layer.
- There is **no book-update route** and **no course-delete route** in the
  current API surface, so those cells do not exist yet.
