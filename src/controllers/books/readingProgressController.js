import readingProgressService from "../../services/reading-progress.service.js";

/**
 * PUT /api/books/:bookId/progress
 * Create or update the reader's progress for a book (upsert per user + book).
 */
export const updateReadingProgress = async (req, res) => {
  try {
    const { bookId } = req.params;
    const userId = req.user._id;
    const { page, totalPages, percentage, lastPosition, device } = req.body;

    const progress = await readingProgressService.upsertProgress({
      userId,
      bookId,
      page,
      totalPages,
      percentage,
      lastPosition,
      device,
    });

    res.status(200).json({ success: true, progress });
  } catch (error) {
    const status = error.message === "Book not found" ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/books/:bookId/progress
 * Resume: return the last stored position for this user + book.
 */
export const getReadingProgress = async (req, res) => {
  try {
    const { bookId } = req.params;
    const userId = req.user._id;

    const progress = await readingProgressService.getProgress({ userId, bookId });

    res.status(200).json({ success: true, progress: progress || null });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/books/library/progress
 * The user's reading library with a progress percentage per book.
 */
export const getReadingLibrary = async (req, res) => {
  try {
    const userId = req.user._id;

    const library = await readingProgressService.getLibraryWithProgress({ userId });

    res.status(200).json({ success: true, library });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
