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
  } else if (file.fieldname === "audio" && isAudioMime(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new APIError("Invalid file format. Thumbnail must be an image, file must be PDF/EPUB, audio must be MP3/M4A.", 400));
  }
};

// Accepted audio mimetypes for audiobook uploads (MP3 and M4A, including the
// alternate MIME labels browsers/clients commonly send for them).
const AUDIO_MIMES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
];

const isAudioMime = (mimetype) => AUDIO_MIMES.includes(mimetype);

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
