/**
 * @module mongo/repositories/BookRepository
 * Data-access layer for the {@link Book} model.
 * -------------------------------------------------------------------------
 * `BookRepository` concentrates every Book-specific persistence query in one
 * place so route handlers and services stop talking to the Mongoose model
 * directly. It follows the conventions declared in `mongo/index.js`:
 *
 *   - Repositories never touch `res`/express — they return data or throw.
 *   - Every exported class/method carries complete JSDoc.
 *
 * Self-containment
 * ----------------
 * The shared `BaseRepository` (Deen-Bridge/dnb-backend#168) is not available
 * yet, so this repository is intentionally standalone: it imports the `Book`
 * model directly and implements its helpers on top of it. The class is shaped
 * so that, once #168 lands, it can `extend BaseRepository` with minimal churn
 * (a `this.model` handle, thin query helpers, typed throwing).
 *
 * Field notes (derived from the real schemas, nothing invented)
 * -------------------------------------------------------------
 *   - Availability: the Book schema has no dedicated `available`/`inStock`
 *     flag, so availability is derived from a book having downloadable content
 *     (`fileUrl` present), with optional price constraints layered on top.
 *   - Tags: the Book schema has no `tags` array; its taxonomy fields are the
 *     free-text `category` string and the `categoryRef` reference. Tag-style
 *     filtering therefore matches against `category`.
 *   - Downloads/reads: the schema tracks consumption via the `readCount`
 *     counter (there is no separate `downloadCount`), so read/download
 *     tracking increments `readCount`.
 *   - Purchases: a completed purchase is recorded in the `Transaction`
 *     collection (`itemType: "book"`, `status: "confirmed"`) and mirrored on
 *     `User.purchasedBooks`; the Book document itself holds no buyer list.
 *
 * @example
 * import BookRepository from "../mongo/repositories/BookRepository.js";
 *
 * const books = await BookRepository.findAvailable({ freeOnly: true, limit: 20 });
 */

import Book from "../../src/models/Book.js";
import Transaction from "../../src/models/Transaction.js";

/**
 * @typedef {Object} QueryOptions
 * @property {number} [limit]           Maximum number of documents to return.
 * @property {number} [skip]            Number of documents to skip (offset).
 * @property {number} [page]            1-based page number; combined with
 *                                      `limit` to compute `skip` when `skip`
 *                                      is not supplied explicitly.
 * @property {Object|string} [sort]     Mongoose sort specification.
 * @property {string|string[]|Object|Object[]} [populate]
 *                                      Path(s) to populate.
 * @property {string|Object} [select]   Projection / field selection.
 * @property {boolean} [lean=false]     Return plain objects instead of
 *                                      hydrated Mongoose documents.
 */

/**
 * Repository exposing Book-specific query helpers on top of the Mongoose
 * `Book` model.
 *
 * Instances are cheap and stateless; a shared default instance is exported so
 * callers can `import BookRepository from ".../BookRepository.js"` and use it
 * immediately, while still allowing `new BookRepository(model)` for tests that
 * need to inject a mock model.
 */
export class BookRepository {
  /**
   * @param {import("mongoose").Model} [model=Book] The Mongoose model this
   *   repository operates on. Defaults to the real `Book` model; accepting it
   *   as a parameter keeps the class testable and mirrors the shape a future
   *   `BaseRepository` subclass will take.
   */
  constructor(model = Book) {
    /**
     * The Mongoose model backing this repository.
     * @type {import("mongoose").Model}
     */
    this.model = model;
  }

  /**
   * Apply shared {@link QueryOptions} (sort, pagination, projection,
   * population, lean) to an existing Mongoose query.
   *
   * @private
   * @param {import("mongoose").Query} query   The query to decorate.
   * @param {QueryOptions} [options={}]         Options to apply.
   * @returns {import("mongoose").Query} The same query, decorated.
   */
  _applyOptions(query, options = {}) {
    const { limit, skip, page, sort, populate, select, lean } = options;

    if (sort) query.sort(sort);
    if (select) query.select(select);

    let effectiveSkip = skip;
    if (effectiveSkip == null && page != null && limit != null) {
      effectiveSkip = (Math.max(1, page) - 1) * limit;
    }
    if (effectiveSkip != null) query.skip(effectiveSkip);
    if (limit != null) query.limit(limit);

    if (populate) {
      const paths = Array.isArray(populate) ? populate : [populate];
      for (const path of paths) query.populate(path);
    }

    if (lean) query.lean();

    return query;
  }

  /**
   * Fetch a single book by its identifier.
   *
   * @param {import("mongoose").Types.ObjectId|string} id Book id.
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object|null>} The book, or `null` if not found.
   * @throws {Error} If `id` is missing.
   */
  async findById(id, options = {}) {
    if (!id) throw new Error("BookRepository.findById: `id` is required");
    return this._applyOptions(this.model.findById(id), options).exec();
  }

  /**
   * Find all books written by a given author.
   *
   * @param {import("mongoose").Types.ObjectId|string} authorId The author's
   *   User id (matched against `Book.author`).
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching books (newest first by default).
   * @throws {Error} If `authorId` is missing.
   */
  async findByAuthor(authorId, options = {}) {
    if (!authorId) {
      throw new Error("BookRepository.findByAuthor: `authorId` is required");
    }
    const query = this.model.find({ author: authorId });
    return this._applyOptions(query, { sort: { createdAt: -1 }, ...options }).exec();
  }

  /**
   * Find "available" books.
   *
   * The Book schema has no explicit availability flag, so a book is considered
   * available when it has downloadable content (`fileUrl` present). Optional
   * price constraints narrow the result further.
   *
   * @param {QueryOptions & {
   *   freeOnly?: boolean,
   *   maxPrice?: number,
   *   minPrice?: number,
   * }} [options={}]
   *   `freeOnly` restricts to books priced at 0; `maxPrice`/`minPrice` bound
   *   the `price` field. Remaining keys are treated as {@link QueryOptions}.
   * @returns {Promise<Object[]>} Available books.
   */
  async findAvailable(options = {}) {
    const { freeOnly, maxPrice, minPrice, ...queryOptions } = options;

    const filter = { fileUrl: { $exists: true, $nin: [null, ""] } };

    if (freeOnly) {
      filter.price = 0;
    } else if (maxPrice != null || minPrice != null) {
      filter.price = {};
      if (minPrice != null) filter.price.$gte = minPrice;
      if (maxPrice != null) filter.price.$lte = maxPrice;
    }

    const query = this.model.find(filter);
    return this._applyOptions(query, { sort: { createdAt: -1 }, ...queryOptions }).exec();
  }

  /**
   * Search books by free text.
   *
   * By default this uses the schema's compound text index
   * (`title`, `description`, `category`) via `$text` and sorts by relevance.
   * Set `useRegex` to fall back to a case-insensitive regex across the same
   * fields (useful for partial-token / prefix matching that `$text` cannot do).
   *
   * @param {string} term The search term.
   * @param {QueryOptions & { useRegex?: boolean }} [options={}]
   *   `useRegex` switches from `$text` to regex matching.
   * @returns {Promise<Object[]>} Matching books.
   * @throws {Error} If `term` is empty.
   */
  async searchBooks(term, options = {}) {
    if (!term || !String(term).trim()) {
      throw new Error("BookRepository.searchBooks: `term` is required");
    }
    const { useRegex, ...queryOptions } = options;
    const trimmed = String(term).trim();

    if (useRegex) {
      const rx = new RegExp(this._escapeRegex(trimmed), "i");
      const query = this.model.find({
        $or: [{ title: rx }, { description: rx }, { category: rx }],
      });
      return this._applyOptions(query, queryOptions).exec();
    }

    const query = this.model.find(
      { $text: { $search: trimmed } },
      { score: { $meta: "textScore" } }
    );
    // Default to relevance ordering unless the caller overrides `sort`.
    const merged = { sort: { score: { $meta: "textScore" } }, ...queryOptions };
    return this._applyOptions(query, merged).exec();
  }

  /**
   * Escape user-supplied text for safe use inside a `RegExp`.
   *
   * @private
   * @param {string} value Raw input.
   * @returns {string} Regex-safe string.
   */
  _escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Find books in a category.
   *
   * Accepts either the free-text `category` string (matched case-insensitively)
   * or a `categoryRef` ObjectId. When `value` looks like a 24-char hex id it is
   * matched against `categoryRef`; otherwise it is matched against `category`.
   *
   * @param {string|import("mongoose").Types.ObjectId} value Category name or
   *   category reference id.
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching books.
   * @throws {Error} If `value` is missing.
   */
  async findByCategory(value, options = {}) {
    if (!value) {
      throw new Error("BookRepository.findByCategory: `value` is required");
    }
    const str = String(value);
    const filter = /^[a-fA-F0-9]{24}$/.test(str)
      ? { categoryRef: value }
      : { category: new RegExp(`^${this._escapeRegex(str)}$`, "i") };

    return this._applyOptions(this.model.find(filter), options).exec();
  }

  /**
   * Filter books by tags.
   *
   * The Book schema has no dedicated `tags` array; its closest taxonomy field
   * is `category`. This method therefore matches books whose `category` is one
   * of the supplied tags (case-insensitive), letting callers filter by a set
   * of topical labels.
   *
   * @param {string|string[]} tags One or more tag/category labels.
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching books.
   * @throws {Error} If no tags are supplied.
   */
  async findByTags(tags, options = {}) {
    const list = (Array.isArray(tags) ? tags : [tags]).filter(
      (t) => t != null && String(t).trim() !== ""
    );
    if (list.length === 0) {
      throw new Error("BookRepository.findByTags: at least one tag is required");
    }
    const patterns = list.map(
      (t) => new RegExp(`^${this._escapeRegex(String(t).trim())}$`, "i")
    );
    const query = this.model.find({ category: { $in: patterns } });
    return this._applyOptions(query, options).exec();
  }

  /**
   * Flexible multi-criterion filter combining the common Book dimensions:
   * author, category/categoryRef, tags (→ `category`), price range and a
   * minimum rating. Any omitted criterion is simply not applied.
   *
   * @param {Object} [criteria={}]
   * @param {import("mongoose").Types.ObjectId|string} [criteria.author]
   * @param {string|import("mongoose").Types.ObjectId} [criteria.category]
   *   Free-text category name (or a `categoryRef` id when 24-char hex).
   * @param {string[]} [criteria.tags] Tag labels matched against `category`.
   * @param {number} [criteria.minPrice]
   * @param {number} [criteria.maxPrice]
   * @param {number} [criteria.minRating] Minimum `rating` (0–5).
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching books.
   */
  async filter(criteria = {}, options = {}) {
    const { author, category, tags, minPrice, maxPrice, minRating } = criteria;
    const filter = {};

    if (author) filter.author = author;

    if (category) {
      const str = String(category);
      if (/^[a-fA-F0-9]{24}$/.test(str)) {
        filter.categoryRef = category;
      } else {
        filter.category = new RegExp(`^${this._escapeRegex(str)}$`, "i");
      }
    }

    if (tags != null) {
      const list = (Array.isArray(tags) ? tags : [tags]).filter(
        (t) => t != null && String(t).trim() !== ""
      );
      if (list.length > 0) {
        filter.category = {
          $in: list.map(
            (t) => new RegExp(`^${this._escapeRegex(String(t).trim())}$`, "i")
          ),
        };
      }
    }

    if (minPrice != null || maxPrice != null) {
      filter.price = {};
      if (minPrice != null) filter.price.$gte = minPrice;
      if (maxPrice != null) filter.price.$lte = maxPrice;
    }

    if (minRating != null) filter.rating = { $gte: minRating };

    return this._applyOptions(this.model.find(filter), options).exec();
  }

  /**
   * Find the books a user has purchased.
   *
   * Purchases are recorded in the `Transaction` collection, not on the Book
   * document, so this resolves the buyer's confirmed book transactions and
   * returns the corresponding Book documents.
   *
   * @param {import("mongoose").Types.ObjectId|string} userId The buyer's id.
   * @param {QueryOptions & { includePending?: boolean }} [options={}]
   *   By default only `confirmed` purchases count; set `includePending` to also
   *   include in-flight (`pending`/`submitted`/`retrying`) transactions.
   * @returns {Promise<Object[]>} The purchased books (may be fewer than the
   *   number of transactions if books were since deleted).
   * @throws {Error} If `userId` is missing.
   */
  async findPurchasedByUser(userId, options = {}) {
    if (!userId) {
      throw new Error("BookRepository.findPurchasedByUser: `userId` is required");
    }
    const { includePending, ...queryOptions } = options;

    const statusFilter = includePending
      ? { $in: ["confirmed", "submitted", "retrying", "pending"] }
      : "confirmed";

    const txns = await Transaction.find({
      buyer: userId,
      itemType: "book",
      itemTypeModel: "Book",
      status: statusFilter,
    })
      .select("itemId")
      .lean()
      .exec();

    const bookIds = [...new Set(txns.map((t) => String(t.itemId)))];
    if (bookIds.length === 0) return [];

    return this.findByPurchaseHistory(bookIds, queryOptions);
  }

  /**
   * Resolve a set of purchased book ids to Book documents.
   *
   * Complements {@link findPurchasedByUser}: given the `bookId`s from a user's
   * `purchasedBooks` history (or any id list), return the live Book documents.
   *
   * @param {Array<import("mongoose").Types.ObjectId|string>} bookIds
   * @param {QueryOptions} [options={}] Query options.
   * @returns {Promise<Object[]>} Matching books.
   * @throws {Error} If `bookIds` is not an array.
   */
  async findByPurchaseHistory(bookIds, options = {}) {
    if (!Array.isArray(bookIds)) {
      throw new Error(
        "BookRepository.findByPurchaseHistory: `bookIds` must be an array"
      );
    }
    if (bookIds.length === 0) return [];
    const query = this.model.find({ _id: { $in: bookIds } });
    return this._applyOptions(query, options).exec();
  }

  /**
   * Atomically increment a book's read/download counter.
   *
   * The Book schema tracks consumption via `readCount` (there is no separate
   * `downloadCount`), so each read or download bumps `readCount`.
   *
   * @param {import("mongoose").Types.ObjectId|string} bookId Book id.
   * @param {number} [amount=1] Amount to increment by (may be negative to
   *   correct an over-count).
   * @returns {Promise<Object|null>} The updated book, or `null` if not found.
   * @throws {Error} If `bookId` is missing or `amount` is not a number.
   */
  async incrementReadCount(bookId, amount = 1) {
    if (!bookId) {
      throw new Error("BookRepository.incrementReadCount: `bookId` is required");
    }
    if (typeof amount !== "number" || Number.isNaN(amount)) {
      throw new Error(
        "BookRepository.incrementReadCount: `amount` must be a number"
      );
    }
    return this.model
      .findByIdAndUpdate(
        bookId,
        { $inc: { readCount: amount }, $set: { updatedAt: new Date() } },
        { new: true }
      )
      .exec();
  }

  /**
   * Return the most-read (most-downloaded) books, ordered by `readCount`.
   *
   * @param {QueryOptions} [options={}] Query options (`limit` recommended).
   * @returns {Promise<Object[]>} Books ordered by descending `readCount`.
   */
  async findMostRead(options = {}) {
    const query = this.model.find({});
    return this._applyOptions(query, { sort: { readCount: -1 }, ...options }).exec();
  }

  /**
   * Count books matching an arbitrary filter.
   *
   * @param {Object} [filter={}] A Mongoose filter object.
   * @returns {Promise<number>} The matching document count.
   */
  async count(filter = {}) {
    return this.model.countDocuments(filter).exec();
  }
}

/**
 * Default shared instance bound to the real `Book` model, mirroring the
 * ergonomics the other `/mongo` exports aim for.
 * @type {BookRepository}
 */
const bookRepository = new BookRepository();

export default bookRepository;
