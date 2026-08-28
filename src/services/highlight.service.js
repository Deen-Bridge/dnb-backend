import Highlight from "../models/highlight.model.js";
import Note from "../models/note.model.js";
import Book from "../models/Book.js";

export class HighlightService {
  async createHighlight({
    userId,
    bookId,
    text,
    color = "yellow",
    pageNumber,
    passage,
    cfiRange,
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

  async getHighlights({ userId, bookId }) {
    const query = { user: userId };
    if (bookId) {
      query.book = bookId;
    }
    return Highlight.find(query).sort({ createdAt: -1 });
  }

  async deleteHighlight({ userId, highlightId }) {
    const highlight = await Highlight.findOneAndDelete({ _id: highlightId, user: userId });
    if (!highlight) {
      throw new Error("Highlight not found or unauthorized");
    }
    await Note.deleteMany({ highlight: highlightId, user: userId });
    return highlight;
  }

  async createNote({
    userId,
    bookId,
    highlightId,
    content,
    pageNumber,
    passage,
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

  async getNotes({ userId, bookId }) {
    const query = { user: userId };
    if (bookId) {
      query.book = bookId;
    }
    return Note.find(query).populate("highlight").sort({ createdAt: -1 });
  }

  async deleteNote({ userId, noteId }) {
    const note = await Note.findOneAndDelete({ _id: noteId, user: userId });
    if (!note) {
      throw new Error("Note not found or unauthorized");
    }
    return note;
  }

  async getHighlightsAndNotes({ userId, bookId }) {
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

  async searchHighlightsAndNotes({
    userId,
    bookId,
    query,
  }) {
    if (!query || query.trim() === "") {
      return { highlights: [], notes: [] };
    }

    const regex = new RegExp(query, "i");
    const filter = { user: userId };
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

  async exportHighlights({
    userId,
    bookId,
    format = "text",
  }) {
    const book = await Book.findById(bookId);
    const { highlights, notes } = await this.getHighlightsAndNotes({ userId, bookId });

    const title = book ? book.title : "Book Highlights & Notes";
    const author = book ? book.author : "Unknown Author";

    if (format === "pdf") {
      const pdfHeader = `%PDF-1.4\n1 0 obj << /Title (${title}) /Author (${author}) >> endobj\n`;
      let pdfContent = `HIGHLIGHTS & NOTES FOR: ${title} by ${author}\n\n`;
      pdfContent += `--- HIGHLIGHTS (${highlights.length}) ---\n`;
      highlights.forEach((h, idx) => {
        pdfContent += `${idx + 1}. [${h.color.toUpperCase()}] Page ${h.pageNumber || "N/A"}: "${h.text}"\n`;
      });
      pdfContent += `\n--- NOTES (${notes.length}) ---\n`;
      notes.forEach((n, idx) => {
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

    let textExport = `=========================================\n`;
    textExport += `BOOK: ${title}\n`;
    textExport += `AUTHOR: ${author}\n`;
    textExport += `EXPORTED: ${new Date().toISOString()}\n`;
    textExport += `=========================================\n\n`;

    textExport += `HIGHLIGHTS (${highlights.length})\n`;
    textExport += `-----------------------------------------\n`;
    highlights.forEach((h, i) => {
      textExport += `${i + 1}. Color: ${h.color} | Page: ${h.pageNumber || "N/A"}\n`;
      textExport += `   "${h.text}"\n\n`;
    });

    textExport += `NOTES (${notes.length})\n`;
    textExport += `-----------------------------------------\n`;
    notes.forEach((n, i) => {
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
