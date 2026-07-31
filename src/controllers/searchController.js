import { searchCollections, searchEducators } from "../services/search/searchService.js";
import logger from "../config/logger.js";

export const searchAll = async (req, res) => {
  try {
    const { q, type = "all", page = 1, limit = 10, sort, minPrice, maxPrice, free, category, minRating, interest } = req.query;
    
    if (q && q.trim().length > 100) {
      return res.status(400).json({ success: false, message: "Query string is too long.", data: null });
    }

    const filters = { minPrice, maxPrice, free, category, minRating, interest };
    
    const result = await searchCollections({ q: q ? q.trim() : "", type, page, limit, sort, filters });
    
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error("Search error:", err);
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode ? err.message : "Server error",
      data: null,
    });
  }
};

export const searchEducatorsHandler = async (req, res) => {
  try {
    const { q, interest, page = 1, limit = 10 } = req.query;
    
    if (q && q.trim().length > 100) {
      return res.status(400).json({ success: false, error: "Query string is too long." });
    }
    
    const result = await searchEducators({ q: q ? q.trim() : "", interest, page, limit });
    
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error("Search educators error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
};
