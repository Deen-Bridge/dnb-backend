import highlightService from "../services/highlight.service.js";

export const createHighlight = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { text, color, pageNumber, passage, cfiRange } = req.body;
    const userId = req.user._id;

    if (!text || text.trim() === "") {
      return res.status(400).json({ success: false, message: "Highlight text is required" });
    }

    const highlight = await highlightService.createHighlight({
      userId,
      bookId,
      text,
      color,
      pageNumber,
      passage,
      cfiRange,
    });

    res.status(201).json({ success: true, highlight });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getHighlights = async (req, res) => {
  try {
    const { bookId } = req.params;
    const userId = req.user._id;

    const highlights = await highlightService.getHighlights({ userId, bookId });
    res.status(200).json({ success: true, highlights });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteHighlight = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const highlight = await highlightService.deleteHighlight({ userId, highlightId: id });
    res.status(200).json({ success: true, message: "Highlight deleted", highlight });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const createNote = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { highlightId, content, pageNumber, passage } = req.body;
    const userId = req.user._id;

    if (!content || content.trim() === "") {
      return res.status(400).json({ success: false, message: "Note content is required" });
    }

    const note = await highlightService.createNote({
      userId,
      bookId,
      highlightId,
      content,
      pageNumber,
      passage,
    });

    res.status(201).json({ success: true, note });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getNotes = async (req, res) => {
  try {
    const { bookId } = req.params;
    const userId = req.user._id;

    const notes = await highlightService.getNotes({ userId, bookId });
    res.status(200).json({ success: true, notes });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteNote = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const note = await highlightService.deleteNote({ userId, noteId: id });
    res.status(200).json({ success: true, message: "Note deleted", note });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getHighlightsAndNotes = async (req, res) => {
  try {
    const { bookId } = req.params;
    const userId = req.user._id;

    const result = await highlightService.getHighlightsAndNotes({ userId, bookId });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const searchHighlightsAndNotes = async (req, res) => {
  try {
    const { bookId } = req.params;
    const query = req.query.q || req.query.query || "";
    const userId = req.user._id;

    const results = await highlightService.searchHighlightsAndNotes({
      userId,
      bookId,
      query,
    });

    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const exportHighlights = async (req, res) => {
  try {
    const { bookId } = req.params;
    const format = req.query.format || "text";
    const userId = req.user._id;

    const exportData = await highlightService.exportHighlights({
      userId,
      bookId,
      format,
    });

    if (format === "pdf") {
      res.setHeader("Content-Type", exportData.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${exportData.filename}"`);
      return res.status(200).send(exportData.content);
    }

    res.setHeader("Content-Type", exportData.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${exportData.filename}"`);
    return res.status(200).send(exportData.content);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export default {
  createHighlight,
  getHighlights,
  deleteHighlight,
  createNote,
  getNotes,
  deleteNote,
  getHighlightsAndNotes,
  searchHighlightsAndNotes,
  exportHighlights,
};
