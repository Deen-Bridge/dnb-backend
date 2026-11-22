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
| `{ paymentReference: 1 }` unique, partial (`$type: "string"`) **new** | canonical memo reconciliation (#695) |
| `{ memo: 1, itemType: 1, status: 1, buyerWallet: 1 }` **new** | bounded legacy memo reconciliation (#695) |
| `{ reconciledAt: 1 }` sparse **new** | worker confirmations per window on the reconciliation status endpoint (#696) |
| field-level indexes (hash unique, etc.), partial TTL | idempotency lookup, expiry of pending checkouts |

The `paymentReference` index is unique (the exception to the note above), but
the field is new and only set on new checkouts, so it cannot fail on existing
data. Build it with `npm run migrate:payment-references`; see
[payment-reconciliation.md](payment-reconciliation.md).

## UnreconciledPayment (`UnreconciledPayment.js`)
| Index | Supports |
|---|---|
| `{ stellarTxHash: 1 }` unique | upsert by hash |
| `{ resolvedAt: 1, reasonCode: 1, createdAt: -1 }` | triage, open count by reason, resolved per window |
| `{ resolvedAt: 1, createdAt: 1 }` **new** | open backlog age buckets and oldest-first sample (#696) |
| `{ createdAt: 1 }` **new** | unreconciled arrivals per window (#696) |

The #696 indexes are built by `npm run migrate:payment-references` as well.

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

## Pledge (`Pledge.js`)
| Index | Supports |
|---|---|
| `{ user: 1 }`, `{ status: 1 }`, `{ nextDueAt: 1 }` | owner lookups, scheduler |
| `{ status: 1, nextDueAt: 1 }` | scheduler: next due active pledge |
| `{ user: 1, createdAt: -1, _id: -1 }` **new** | donor pledge history pages, newest first (#698) |
| `{ user: 1, status: 1, createdAt: -1, _id: -1 }` **new** | the same, filtered by `status` (#698) |

## PledgeCycle (`PledgeCycle.js`)
| Index | Supports |
|---|---|
| `{ pledge: 1, dueAt: 1 }` unique | scheduler upsert; cycle history with `includeArchived=true` (walked backwards) |
| `{ pledge: 1, archivedAt: 1, dueAt: -1 }` **new** | default cycle history (unarchived), latest due first (#698) |
| `{ status: 1, archivedAt: 1, dueAt: 1 }` **new** | retention sweep over settled, unarchived cycles (#698) |
| `{ status: 1 }`, `{ windowEndsAt: 1 }`, `{ pledge: 1 }` | scheduler lapse check, owner lookups |

The #698 list endpoints fetch `limit + 1` rows from these indexes, so the
documents examined per page stay constant as history grows
(`test/pledgeHistory.test.js` checks this with `explain("executionStats")`).
See [pledges.md](pledges.md).

## Wallets
There is no standalone wallet model; wallet addresses live on `User` and `Transaction` (`buyerWallet`, `creatorWallet`). `OnrampTransaction` was not audited in this pass.

## Verification
`explain()` was not run (no production-like dataset locally). Confirm with
`db.<collection>.find(...).explain("executionStats")` on staging and check for `IXSCAN`.
