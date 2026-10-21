# Database Seeding Guide

This guide documents every seed, migration and data script in the repository. It is based on the code in `mongo/seeds/`, `src/scripts/`, `src/migrations/` and the `scripts` section of `package.json`.

## Prerequisites

- Node.js 18+ and `npm install` completed.
- A reachable MongoDB instance (local or Atlas).
- A `.env` file (copy `.env.example`) containing **`MONGO_URI`**, the MongoDB connection string. All scripts load `.env` through `dotenv` and exit or throw if `MONGO_URI` is not set.

> **WARNING: seed scripts write to whichever database `MONGO_URI` points at.** Several of them delete data. Never run them against staging or production. Check the database name in your connection string first.

## Quick reference

| Command | Script | Deletes data? | Summary |
|---------|--------|---------------|---------|
| `npm run db:seed` | `mongo/seeds/index.js` | No | Insert the minimal dataset (same as `--minimal`) |
| `npm run db:seed:minimal` | `mongo/seeds/index.js --minimal` | No | Insert the minimal dataset |
| `npm run db:seed:full` | `mongo/seeds/index.js --full` | No | Insert the full dataset |
| `npm run db:seed:reset` | `mongo/seeds/index.js --reset` | **YES** | Wipe users, courses, books and spaces, then insert the minimal dataset |
| `npm run db:seed:clean` | `mongo/seeds/index.js --clean` | **YES** | Wipe users, courses, books and spaces, insert nothing |
| `npm run seed` | `src/scripts/seedDatabase.js` | **YES** | Legacy script: wipe courses, books and spaces, insert sample data |
| `npm run seed:categories` | `src/scripts/seedCategories.js` | No | Upsert the default category tree |
| `npm run migrate:categories` | `src/scripts/migrateCategories.js` | No (updates documents) | Link existing courses and books to `Category` documents |
| `npm run migrate:review-stats` | `src/migrations/backfillReviewStats.js` | No (updates documents) | Recompute rating stats on courses and books from their reviews |
| (no npm script) `node src/scripts/auditPayouts.js` | `src/scripts/auditPayouts.js` | No | Read-only educator payout ledger audit |

## Recommended fresh local setup

1. Start MongoDB and set `MONGO_URI` in `.env` to a **local or throwaway** database.
2. Seed the main sample data:
   ```bash
   npm run db:seed        # minimal, or: npm run db:seed:full
   ```
3. Seed the default categories:
   ```bash
   npm run seed:categories
   ```
4. Optional: run `npm run migrate:categories` to link the seeded courses and books to the categories (see below).
5. Log in with any seeded account (see "Seeded accounts").

Note: `db:seed` inserts with `insertMany` and does not check for existing records. Users have a unique `email`, so running `db:seed` a second time against a database that already holds the seeded users will fail. To start over, use `db:seed:reset` (destructive, see below).

## Main seeder: `mongo/seeds/index.js`

This is the seeder intended for local development and testing. It connects with `MONGO_URI`, optionally wipes collections, then inserts users, courses, books and spaces. Courses, books and spaces are owned by the first seeded verified educator (`mentor` with `verifiedEducator`), falling back to the admin, then the first user.

Flags: `--minimal` (default), `--full`, `--reset`, `--clean`. `--full` and `--minimal` pick the dataset; `--reset` and `--clean` trigger the wipe. If `--full` and `--reset` are passed together by calling the script directly (`node mongo/seeds/index.js --reset --full`), the wipe happens and the full dataset is inserted; the npm scripts only pass one flag each.

### Data produced

| Collection | Minimal | Full (superset of minimal) |
|------------|---------|----------------------------|
| users | 3 | 9 |
| courses | 3 | 10 |
| books | 3 | 10 |
| spaces | 3 | 10 |

- **Users**: an admin, verified educators (`mentor`) and students, all with `isVerified: true`. Minimal accounts: `admin@deenbridge.dev`, `instructor@deenbridge.dev`, `learner@deenbridge.dev`. The full set adds `omar@`, `maryam@`, `ibrahim@`, `zaynab@`, `bilal@`, `khadija@` and `hassan@deenbridge.dev`.
- **Courses**: created with `status: "published"`, each with a sample module and lessons, `rating` 4.8, `numReviews` 0 and `views` 0.
- **Books**: sample titles with placeholder `example.com` file URLs and picsum.photos images.
- **Spaces**: all `status: "upcoming"`.

### Seeded accounts

Every seeded user has the same development password: `DeenBridge#2024`. This is for local use only; never seed these accounts anywhere reachable by others.

### `db:seed:reset` vs `db:seed:clean`

Both run `deleteMany({})` on the **users, courses, books and spaces** collections. There is no confirmation prompt and no filter: it removes ALL documents in those collections, not only previously seeded ones.

| | `db:seed:reset` | `db:seed:clean` |
|---|---|---|
| Wipes users, courses, books, spaces | Yes | Yes |
| Inserts new seed data | Yes (minimal) | No |
| Use when | You want a known-good starting state | You want empty collections |

> **DESTRUCTIVE: `db:seed:reset` and `db:seed:clean` permanently delete every user, course, book and space in the target database.** Other collections (for example categories, payments or enrollments) are not touched by these scripts, so they can be left pointing at documents that no longer exist.

## Legacy seeder: `npm run seed` (`src/scripts/seedDatabase.js`)

A separate, older script. Differences from the main seeder:

- Inserts **10 courses, 10 books and 10 spaces** (no users, no flags, no modules/lessons).
- **Destructive**: if the courses, books or spaces collections have any documents, it calls `deleteMany({})` on them before inserting. Users are not touched.
- Every record uses a hard-coded placeholder user ObjectId (`6a6bd5bdf43b44b676794be5`) as `createdBy` / `author` / `host`. This ID will not match a real user unless you create one with that ID, so the relationships will dangle. The comment in the file suggests replacing it with a real user ID.
- Uses the legacy free-text course/book `category` strings (for example "Qur'an & Tafsir"), and picsum.photos / example.com URLs.

Prefer `npm run db:seed` for local development. Do not run both against the same data without understanding that `npm run seed` will wipe courses, books and spaces.

## Category scripts

### `npm run seed:categories` (`src/scripts/seedCategories.js`)

Upserts (by `slug`) 8 top-level categories (Qur'an, Hadith, Aqeedah, Fiqh, Seerah / History, Arabic Language, Islamic Finance, Spirituality / Tazkiyah), with Tajweed and Tafsir as children of Qur'an. It sets name, order and `isActive: true`. It is idempotent and does not delete anything, so it is safe to re-run. It is also exported as `seedCategories()` and only auto-runs when invoked directly.

### `npm run migrate:categories` (`src/scripts/migrateCategories.js`)

A data migration, not a seeder. It collects the distinct `category` string values from all courses and books and, for each:

1. Finds a `Category` by slug or case-insensitive name, or creates one if none exists.
2. Updates courses and books with that `category` value **that do not yet have a `categoryRef`**, setting `categoryRef` to the category's id and `category` to the category's name.

It does not delete data, but it does modify existing course and book documents (the `category` string may be rewritten to the category's name). Back up first if the data matters. Documents that already have a `categoryRef` are skipped, so re-running is safe.

## Other data scripts

- `npm run migrate:review-stats` (`src/migrations/backfillReviewStats.js`): for every course and book, recomputes `rating`, `numReviews` and `ratingBreakdown` from the embedded `reviews` and updates only documents whose stored values differ. Requires `MONGO_URI`.
- `node src/scripts/auditPayouts.js` (no npm script): reads the educator earnings ledger and compares it to stored balances using the app's DB config and logger. It reports mismatches and exits with code 1 if any are found, 0 otherwise. It is an audit and does not seed anything.
