import mongoose from "mongoose";

/**
 * ReadingProgress
 *
 * Stores a single reading-progress record per user + book combination so that
 * progress can be resumed and synced across a user's devices. Mirrors the
 * CourseProgress model style: ObjectId refs, a unique compound index and
 * mongoose timestamps (createdAt / updatedAt).
 */
const readingProgressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    book: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Book",
      required: true,
      index: true,
    },
    // Current page the reader is on (0-based / 1-based is up to the client).
    page: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Total number of pages, when the client knows it. Used to derive a
    // percentage on the fly if the client only reports the page.
    totalPages: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Completion percentage, 0-100.
    percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // Opaque resume token (e.g. an EPUB CFI or PDF locator) so the reader can
    // resume from the exact last position, not just the page number.
    lastPosition: {
      type: String,
      default: "",
    },
    // Identifier of the device that last wrote progress. Lets a client ignore
    // echoes of its own updates when syncing across devices.
    device: {
      type: String,
      default: "",
    },
    // Monotonic version bumped on every update. A client can poll the library
    // endpoint and compare versions (or updatedAt) to detect changes made on
    // another device without needing a live socket connection.
    version: {
      type: Number,
      default: 0,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// One progress record per user + book combination.
readingProgressSchema.index({ user: 1, book: 1 }, { unique: true });

export default mongoose.model("ReadingProgress", readingProgressSchema);
