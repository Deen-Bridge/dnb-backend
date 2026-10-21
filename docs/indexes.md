# MongoDB indexes (high-traffic models)

Audit for issue #463. Indexes are declared in the Mongoose schemas under `src/models/`.
Mongoose builds them via `autoIndex`; in production, build new ones during a low-traffic window.
All indexes below are non-unique, so they cannot fail on existing data.

## User (`User.js`)
| Index | Supports |
|---|---|
| `{ email: 1 }` unique (field `unique: true`) | login / register lookup by email |
| `{ role: 1 }`, `{ verifiedEducator: 1 }` | educator/admin listings |
| text on `name, bio, interests` | user search |

## Course (`Course.js`)
| Index | Supports |
|---|---|
| `{ status: 1, createdAt: -1 }` | public listing, newest first |
| `{ createdBy: 1 }` | educator's courses |
| `{ categoryRef: 1, status: 1 }` | category filter (ref) |
| `{ category: 1, status: 1 }` **new** | `Course.find({ category: { $in: interests } })` and string-category filters |
| `{ enrolledUsers: 1 }` | "my courses", enrolled counts |
| `{ rating: -1 }`, text index | top-rated sort, search |

## Transaction (`Transaction.js`)
| Index | Supports |
|---|---|
| `{ buyer: 1, status: 1 }`, `{ creator: 1, status: 1 }` | per-user, per-status filters |
| `{ buyer: 1, createdAt: -1 }` **new** | purchase history / export, `sort({createdAt:-1})` |
| `{ creator: 1, createdAt: -1 }` **new** | creator earnings / payout listings |
| `{ itemType: 1, itemId: 1 }` | access checks per item |
| `{ type: 1, status: 1, createdAt: -1 }` | donation stats |
| field-level indexes (hash unique, etc.), partial TTL | idempotency lookup, expiry of pending checkouts |

## Reel (`Reel.js`)
| Index | Supports |
|---|---|
| `{ createdAt: -1 }` | main feed |
| `{ createdBy: 1, createdAt: -1 }` **new** | a creator's reels |
| `{ tags: 1, status: 1, isRemoved: 1, createdAt: -1 }` **new** | hashtag feed (`tags`, `status: "active"`, `isRemoved: false`) |
| `{ originalReelId: 1, createdAt: -1 }` | duets/stitches |
| text on `description` | search |

## Notification (`Notification.js`)
Already covered: `{ recipient, createdAt }`, `{ recipient, isRead }`, `{ recipient, isDeleted }`, `{ recipient, isDeleted, createdAt }` for per-user lists and unread counts.

## Wallets
There is no standalone wallet model; wallet addresses live on `User` and `Transaction` (`buyerWallet`, `creatorWallet`). `OnrampTransaction` was not audited in this pass.

## Verification
`explain()` was not run (no production-like dataset locally). Confirm with
`db.<collection>.find(...).explain("executionStats")` on staging and check for `IXSCAN`.
