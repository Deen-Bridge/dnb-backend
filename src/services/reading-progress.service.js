import ReadingProgress from "../models/ReadingProgress.js";
import Book from "../models/Book.js";
import { emitProgress } from "../sockets/reading-progress.socket.js";

/**
 * ReadingProgressService
 *
 * Persists one progress record per user + book (upsert), exposes a resume
 * endpoint and augments a user's book-library listing with progress %. Mirrors
 * the class-based service style used across the codebase (e.g. HighlightService,
 * SpacePollService).
 */
export class ReadingProgressService {
  /**
   * Derive a 0-100 percentage. Prefers an explicit percentage; otherwise
   * computes it from page / totalPages when both are known.
   */
  computePercentage({ percentage, page, totalPages }) {
    if (percentage !== undefined && percentage !== null) {
      return Math.min(100, Math.max(0, Number(percentage)));
    }
    if (totalPages && totalPages > 0 && page !== undefined && page !== null) {
      return Math.min(100, Math.max(0, Number(((page / totalPages) * 100).toFixed(2))));
    }
    return undefined;
  }

  /**
   * Create or update the reading-progress record for a user + book. Upserts so
   * there is never more than one record per combination, bumps `version` and
   * (via timestamps) `updatedAt`, then emits a real-time sync event to the
   * user's other devices when a socket layer is attached.
   */
  async upsertProgress({ userId, bookId, page, totalPages, percentage, lastPosition, device }) {
    const book = await Book.findById(bookId).select("_id");
    if (!book) {
      throw new Error("Book not found");
    }

    const set = {};
    if (page !== undefined && page !== null) set.page = page;
    if (totalPages !== undefined && totalPages !== null) set.totalPages = totalPages;
    if (lastPosition !== undefined && lastPosition !== null) set.lastPosition = lastPosition;
    if (device !== undefined && device !== null) set.device = device;

    const computed = this.computePercentage({ percentage, page, totalPages });
    if (computed !== undefined) {
      set.percentage = computed;
      if (computed >= 100) {
        set.completedAt = new Date();
      }
    }

    const progress = await ReadingProgress.findOneAndUpdate(
      { user: userId, book: bookId },
      { $set: set, $inc: { version: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Push to the user's other devices (no-op if no socket server is wired).
    emitProgress(userId, {
      book: bookId,
      page: progress.page,
      percentage: progress.percentage,
      lastPosition: progress.lastPosition,
      version: progress.version,
      updatedAt: progress.updatedAt,
      device: progress.device,
    });

    return progress;
  }

  /**
   * Get the stored progress for a user + book so the reader can resume from the
   * last position. Returns null when there is no record yet.
   */
  async getProgress({ userId, bookId }) {
    return ReadingProgress.findOne({ user: userId, book: bookId });
  }

  /**
   * Return the user's reading library augmented with progress. Each entry pairs
   * the populated book with its progress percentage / last position so the
   * frontend can display a progress bar on the library view.
   */
  async getLibraryWithProgress({ userId }) {
    const records = await ReadingProgress.find({ user: userId })
      .sort({ updatedAt: -1 })
      .populate("book", "title author image category price");

    return records
      // A book may have been deleted after progress was stored.
      .filter((record) => record.book)
      .map((record) => ({
        book: record.book,
        page: record.page,
        totalPages: record.totalPages,
        percentage: record.percentage,
        lastPosition: record.lastPosition,
        version: record.version,
        completedAt: record.completedAt,
        updatedAt: record.updatedAt,
      }));
  }
}

export const readingProgressService = new ReadingProgressService();
export default readingProgressService;
