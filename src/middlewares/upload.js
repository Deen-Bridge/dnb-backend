import multer from "multer";
import { APIError } from "./errorHandler.js";

const storage = multer.memoryStorage();

const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new APIError("Not an image! Please upload only images.", 400));
  }
};

const bookFilter = (req, file, cb) => {
  if (
    file.fieldname === "thumbnail" &&
    file.mimetype.startsWith("image/")
  ) {
    cb(null, true);
  } else if (
    file.fieldname === "file" &&
    (file.mimetype === "application/pdf" ||
      file.mimetype === "application/epub+zip")
  ) {
    cb(null, true);
  } else {
    cb(new APIError("Invalid file format. Thumbnail must be an image, file must be PDF/EPUB.", 400));
  }
};

export const uploadImage = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: imageFilter,
});

export const uploadBook = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: bookFilter,
});

// Default export for backward compatibility where not yet replaced
export default uploadImage;
