import Highlight from "../models/highlight.model.ts";
import Note from "../models/note.model.ts";
import Book from "../models/Book.js";

export class HighlightService {
  /**
   * Save a new text highlight for a book.
   */
  async createHighlight({
    userId,
    bookId,
    text,
    color = "yellow",
    pageNumber,
    passage,
    cfiRange,
  }: {
    userId: string;
    bookId: string;
    text: string;
    color?: string;
    pageNumber?: number;
    passage?: string;
    cfiRange?: string;
  }) {
    const book = await Book.findById(bookId);
    if (!book) {
      throw new Error("Book not found");
    }

    const highlight = await Highlight.create({
      user: userId,
      book: bookId,
      text,
      color,
      pageNumber,
      passage,
      cfiRange,
    });

    return highlight;
  }

  /**
   * Get all highlights for a book by a specific user.
   */
  async getHighlights({ userId, bookId }: { userId: string; bookId?: string }) {
    const query: any = { user: userId };
    if (bookId) {
      query.book = bookId;
    }
    return Highlight.find(query).sort({ createdAt: -1 });
  }

  /**
   * Delete a highlight owned by user.
   */
  async deleteHighlight({ userId, highlightId }: { userId: string; highlightId: string }) {
    const highlight = await Highlight.findOneAndDelete({ _id: highlightId, user: userId });
    if (!highlight) {
      throw new Error("Highlight not found or unauthorized");
    }
    // Delete associated notes if any
    await Note.deleteMany({ highlight: highlightId, user: userId });
    return highlight;
  }

  /**
   * Add a note to a specific passage, page, or highlight.
   */
  async createNote({
    userId,
    bookId,
    highlightId,
    content,
    pageNumber,
    passage,
  }: {
    userId: string;
    bookId: string;
    highlightId?: string;
    content: string;
    pageNumber?: number;
    passage?: string;
  }) {
    const book = await Book.findById(bookId);
    if (!book) {
      throw new Error("Book not found");
    }

    if (highlightId) {
      const highlight = await Highlight.findById(highlightId);
      if (!highlight) {
        throw new Error("Target highlight not found");
      }
    }

    const note = await Note.create({
      user: userId,
      book: bookId,
      highlight: highlightId || undefined,
      content,
      pageNumber,
      passage,
    });

    return note;
  }

  /**
   * Get all notes for a book by user.
   */
  async getNotes({ userId, bookId }: { userId: string; bookId?: string }) {
    const query: any = { user: userId };
    if (bookId) {
      query.book = bookId;
    }
    return Note.find(query).populate("highlight").sort({ createdAt: -1 });
  }

  /**
   * Delete a note owned by user.
   */
  async deleteNote({ userId, noteId }: { userId: string; noteId: string }) {
    const note = await Note.findOneAndDelete({ _id: noteId, user: userId });
    if (!note) {
      throw new Error("Note not found or unauthorized");
    }
    return note;
  }

  /**
   * View all highlights and notes for a book.
   */
  async getHighlightsAndNotes({ userId, bookId }: { userId: string; bookId: string }) {
    const [highlights, notes] = await Promise.all([
      this.getHighlights({ userId, bookId }),
      this.getNotes({ userId, bookId }),
    ]);

    return {
      bookId,
      highlights,
      notes,
    };
  }

  /**
   * Search through highlights and notes.
   */
  async searchHighlightsAndNotes({
    userId,
    bookId,
    query,
  }: {
    userId: string;
    bookId?: string;
    query: string;
  }) {
    if (!query || query.trim() === "") {
      return { highlights: [], notes: [] };
    }

    const regex = new RegExp(query, "i");
    const filter: any = { user: userId };
    if (bookId) {
      filter.book = bookId;
    }

    const [highlights, notes] = await Promise.all([
      Highlight.find({
        ...filter,
        $or: [{ text: regex }, { passage: regex }],
      }).sort({ createdAt: -1 }),
      Note.find({
        ...filter,
        $or: [{ content: regex }, { passage: regex }],
      })
        .populate("highlight")
        .sort({ createdAt: -1 }),
    ]);

    return { highlights, notes };
  }

  /**
   * Export highlights and notes as text or PDF formatted structure.
   */
  async exportHighlights({
    userId,
    bookId,
    format = "text",
  }: {
    userId: string;
    bookId: string;
    format?: string;
  }) {
    const book = await Book.findById(bookId);
    const { highlights, notes } = await this.getHighlightsAndNotes({ userId, bookId });

    const title = book ? book.title : "Book Highlights & Notes";
    const author = book ? book.author : "Unknown Author";

    if (format === "pdf") {
      // Build PDF document format string / buffer structure
      const pdfHeader = `%PDF-1.4\n1 0 obj << /Title (${title}) /Author (${author}) >> endobj\n`;
      let pdfContent = `HIGHLIGHTS & NOTES FOR: ${title} by ${author}\n\n`;
      pdfContent += `--- HIGHLIGHTS (${highlights.length}) ---\n`;
      highlights.forEach((h: any, idx: number) => {
        pdfContent += `${idx + 1}. [${h.color.toUpperCase()}] Page ${h.pageNumber || "N/A"}: "${h.text}"\n`;
      });
      pdfContent += `\n--- NOTES (${notes.length}) ---\n`;
      notes.forEach((n: any, idx: number) => {
        pdfContent += `${idx + 1}. Page ${n.pageNumber || "N/A"}: ${n.content}\n`;
      });

      return {
        format: "pdf",
        mimeType: "application/pdf",
        filename: `${title.toLowerCase().replace(/[^a-z0-9]/g, "_")}_highlights.pdf`,
        content: pdfHeader + Buffer.from(pdfContent).toString("utf8"),
        rawText: pdfContent,
      };
    }

    // Default text format
    let textExport = `=========================================\n`;
    textExport += `BOOK: ${title}\n`;
    textExport += `AUTHOR: ${author}\n`;
    textExport += `EXPORTED: ${new Date().toISOString()}\n`;
    textExport += `=========================================\n\n`;

    textExport += `HIGHLIGHTS (${highlights.length})\n`;
    textExport += `-----------------------------------------\n`;
    highlights.forEach((h: any, i: number) => {
      textExport += `${i + 1}. Color: ${h.color} | Page: ${h.pageNumber || "N/A"}\n`;
      textExport += `   "${h.text}"\n\n`;
    });

    textExport += `NOTES (${notes.length})\n`;
    textExport += `-----------------------------------------\n`;
    notes.forEach((n: any, i: number) => {
      textExport += `${i + 1}. Page: ${n.pageNumber || "N/A"}\n`;
      textExport += `   Note: ${n.content}\n\n`;
    });

    return {
      format: "text",
      mimeType: "text/plain",
      filename: `${title.toLowerCase().replace(/[^a-z0-9]/g, "_")}_highlights.txt`,
      content: textExport,
    };
  }
}

export const highlightService = new HighlightService();
export default highlightService;
