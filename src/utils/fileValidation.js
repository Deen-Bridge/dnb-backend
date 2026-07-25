import { fileTypeFromBuffer } from "file-type";
import logger from "../config/logger.js";

/**
 * Validates the magic bytes of a file buffer against a list of allowed MIME types.
 * @param {Buffer} buffer - The file buffer to check.
 * @param {string[]} allowedMimeTypes - Array of allowed MIME types (e.g., ['image/jpeg', 'application/pdf']).
 * @returns {Promise<boolean>} True if the file type matches one of the allowed types.
 */
export const validateMagicBytes = async (buffer, allowedMimeTypes) => {
  if (!buffer || buffer.length === 0) {
    logger.warn("Empty buffer provided for magic byte validation");
    return false;
  }

  try {
    const type = await fileTypeFromBuffer(buffer);

    if (!type) {
      logger.warn("Could not determine file type from buffer");
      return false;
    }

    const isValid = allowedMimeTypes.includes(type.mime);
    if (!isValid) {
      logger.warn(`File type mismatch: expected one of [${allowedMimeTypes.join(", ")}], got ${type.mime}`);
    }

    return isValid;
  } catch (error) {
    logger.error("Error validating magic bytes:", error);
    return false;
  }
};
