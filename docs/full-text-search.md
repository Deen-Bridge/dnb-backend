# Full-Text Search Configuration Guide

This document explains how to configure MongoDB text indexes and use the full-text search abstraction provided by the `mongo/utils/textSearch.js` utility and the `mongo/mixins/Searchable.js` mixin.

## Overview

The full-text search abstraction provides:

1. **Score-based ranking** — Results are ordered by MongoDB's computed text-match score (`$meta: "textScore"`), not just returned in natural/insertion order.

2. **Composable filters** — Additional filter criteria (e.g. price range, category) can be combined with text search without breaking correct score-based ordering.

3. **Offset-based pagination** — Supports `page`/`limit` pagination alongside score-based sorting.

4. **Reusable interface** — The `Searchable` mixin gives every model the same `.search()` method, eliminating duplicated query-building logic.

## Text Index Configuration

### Basic Text Index

To make a model searchable, you must define a text index on the fields you want to search. Add this to your Mongoose schema definition:

```javascript
// Simple text index on a single field
bookSchema.index({ title: "text" });

// Compound text index across multiple fields
bookSchema.index({ title: "text", description: "text", category: "text" });
```

### Weighted Text Index

You can assign weights to fields so that matches in more important fields rank higher:

```javascript
// Title matches are 5x more important than description or category matches
bookSchema.index(
  { title: "text", description: "text", category: "text" },
  { weights: { title: 5 } }
);
```

**Current models with weighted text indexes:**
- `Book`: `{ title: 5, description: 1, category: 1 }`
- `Course`: `{ title: 5, description: 1, category: 1 }`

### Language Options

MongoDB supports stemming and stop-words for many languages. You can configure these per index:

```javascript
// English (default)
userSchema.index(
  { name: "text", bio: "text", interests: "text" },
  { default_language: "english" }
);

// Disable language processing (treat all tokens as literals)
userSchema.index(
  { name: "text", bio: "text" },
  { default_language: "none" }
);

// Use a specific language override field
userSchema.index(
  { name: "text", bio: "text" },
  { default_language: "english", language_override: "lang" }
);
```

**Current models with language options:**
- `User`: `{ default_language: "none", language_override: "lang" }`

### Partial Index (Performance Optimization)

If you only need to search a subset of documents, use a partial index to reduce index size:

```javascript
// Only index active books
bookSchema.index(
  { title: "text", description: "text" },
  { partialFilterExpression: { isActive: true } }
);

// Only index books that have content
bookSchema.index(
  { title: "text", description: "text" },
  { partialFilterExpression: { fileUrl: { $exists: true } } }
);
```

### Wildcard Text Index (MongoDB 4.2+)

To search across all string fields:

```javascript
// Search all string fields (use with caution — may impact performance)
bookSchema.index({ "$**": "text" });
```

## Using the Text Search Utility

### Basic Search

```javascript
import { textSearch } from "../mongo/utils/textSearch.js";
import Book from "../src/models/Book.js";

const results = await textSearch({
  model: Book,
  term: "react patterns",
  page: 1,
  limit: 10,
});

// results.documents — Array of matching books with `score` field
// results.total — Total matching documents
// results.page — Current page number
// results.pages — Total pages
```

### Search with Filters

```javascript
const results = await textSearch({
  model: Book,
  term: "node.js",
  filters: {
    price: { $gte: 0, $lte: 50 },
    category: "Programming",
  },
  page: 1,
  limit: 20,
});
```

### Custom Projection

```javascript
const results = await textSearch({
  model: Book,
  term: "design patterns",
  projection: { title: 1, price: 1, rating: 1 },
  page: 1,
  limit: 10,
});
```

### Custom Sort

```javascript
// Sort by price ascending (score still available in returned documents)
const results = await textSearch({
  model: Book,
  term: "javascript",
  sort: { price: 1 },
  page: 1,
  limit: 10,
});
```

## Using the Searchable Mixin

The `Searchable` mixin provides a convenient `.search()` static method on your model:

```javascript
import { applySearchable } from "../mongo/mixins/Searchable.js";

const bookSchema = new mongoose.Schema({
  title: String,
  description: String,
  category: String,
  price: Number,
});

// Define the text index
bookSchema.index({ title: "text", description: "text", category: "text" }, { weights: { title: 5 } });

// Apply the mixin (must be called after defining the schema, before compiling the model)
applySearchable(bookSchema, {
  defaultFields: ["title", "description", "category", "price"],
  defaultFilters: { isActive: true },
});

const Book = mongoose.model("Book", bookSchema);

// Now you can use .search() directly on the model
const results = await Book.search({
  term: "react patterns",
  filters: { price: { $gte: 0 } },
  page: 1,
  limit: 10,
});
```

### Mixin Options

| Option | Type | Description |
|--------|------|-------------|
| `defaultFields` | `string[]` | Fields to project by default when no explicit projection is provided |
| `defaultFilters` | `Object` | Filters always applied (merged with caller-supplied filters) |

### Mixin Helper Methods

When you apply the mixin, these static methods are also available:

- `Model._buildSearchFilter(term, filters)` — Build a text-search filter without executing
- `Model._buildSearchProjection(extraProjection)` — Build a projection with score field
- `Model._buildSearchSort(customSort)` — Build a sort specification

## Accessing the Text Score

When using either the utility or the mixin, each document in the results includes a `score` field with the text-match relevance score:

```javascript
const results = await textSearch({ model: Book, term: "react" });

results.documents.forEach((doc) => {
  console.log(`${doc.title}: score ${doc.score}`);
});
```

The score is:
- Higher for documents that match more terms
- Higher for documents where matched terms appear in weighted fields (e.g. `title`)
- Based on term frequency and inverse document frequency (TF-IDF)

## Pagination Notes

### Offset Pagination (page/limit)

The default pagination is offset-based (`page`/`limit`), which is suitable for most search UIs where users navigate to specific page numbers.

**Important:** When paginating with score-based sorting, MongoDB guarantees consistent results within a single query. However, if documents are inserted or deleted between page loads, results may shift slightly. This is acceptable for search use cases.

### Cursor-Based Pagination

For large datasets or infinite scroll, consider using cursor-based pagination from `mongo/utils/cursorPagination.js`. The text search utilities build filters that can be composed with cursor pagination:

```javascript
import { buildTextFilter, buildTextProjection } from "../mongo/utils/textSearch.js";
import { paginate } from "../mongo/utils/cursorPagination.js";

const filter = buildTextFilter("react", { price: { $gte: 0 } });
const projection = buildTextProjection({ title: 1 });

// Use paginate with the text search filter
const results = await paginate({
  executor: ({ filter: cursorFilter, sort, limit }) =>
    Book.find({ $and: [filter, cursorFilter] }, projection)
      .sort(sort)
      .limit(limit)
      .lean(),
  sortField: "score",
  sortOrder: -1,
  limit: 20,
});
```

**Note:** Score-based cursor pagination is complex because the score is computed by MongoDB, not stored on the document. The example above uses a hybrid approach. For most applications, offset pagination is sufficient.

## Current Models with Text Indexes

| Model | Fields | Weights | Language |
|-------|--------|---------|----------|
| Book | `title`, `description`, `category` | `title: 5` | default (english) |
| Course | `title`, `description`, `category` | `title: 5` | default (english) |
| User | `name`, `bio`, `interests` | none | `none` (language_override: `lang`) |

## Testing Text Indexes

When testing with MongoDB Memory Server, you must call `syncIndexes()` after connecting to ensure text indexes are created:

```javascript
beforeEach(async () => {
  await Book.deleteMany({});
  await Book.syncIndexes(); // Ensures text index exists
});
```

## Common Pitfalls

1. **Only one text index per collection:** MongoDB only allows one text index per collection. If you need to search different field combinations, use a single compound text index.

2. **Text index + regular index conflict:** You cannot have both a text index and a regular index on the same field combination. Remove redundant regular indexes.

3. **Case sensitivity:** Text search is case-insensitive by default. Don't add case-insensitive regex filters alongside text search.

4. **Short search terms:** MongoDB requires at least 3 characters for `$text` search. The existing `searchService.js` falls back to regex for shorter terms.

5. **Performance:** Text indexes can be large. Use partial indexes and field projections to minimize memory usage.
