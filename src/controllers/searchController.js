import { searchCollections, searchEducators } from "../services/search/searchService.js";
import logger from "../config/logger.js";
import { ERROR_CODES, buildErrorResponse } from "../config/errorCodes.js";

export const searchAll = async (req, res) => {
  try {
    const { q, type = "all", page = 1, limit = 20, sort, cursor, minPrice, maxPrice, free, category, minRating, interest } = req.query;
    
    if (q && q.trim().length > 100) {
      return res.status(400).json(buildErrorResponse(ERROR_CODES.VALIDATION_ERROR, "Query string is too long."));
    }

    const filters = { minPrice, maxPrice, free, category, minRating, interest };
    
    const result = await searchCollections({ q: q ? q.trim() : "", type, page, limit, sort, cursor, filters });
    
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error("Search error:", err);
    const code = err.statusCode ? (err.statusCode === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.VALIDATION_ERROR) : ERROR_CODES.INTERNAL_ERROR;
    res.status(err.statusCode || 500).json(
      buildErrorResponse(code, err.statusCode ? err.message : "Server error")
    );
  }
};

export const searchEducatorsHandler = async (req, res) => {
  try {
    const { q, interest, page = 1, limit = 20, cursor } = req.query;
    
    if (q && q.trim().length > 100) {
      return res.status(400).json(buildErrorResponse(ERROR_CODES.VALIDATION_ERROR, "Query string is too long."));
    }
    
    const result = await searchEducators({ q: q ? q.trim() : "", interest, page, limit, cursor });
    
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error("Search educators error:", err);
    res.status(500).json(buildErrorResponse(ERROR_CODES.INTERNAL_ERROR, "Server error"));
  }
};
