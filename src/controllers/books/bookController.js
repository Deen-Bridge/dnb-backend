import axios from "axios";
import mongoose from "mongoose";
import Book from "../../models/Book.js";
import User from "../../models/User.js";
import cloudinary from "../../utils/cloudinary.js";
import logger from "../../config/logger.js";
import { validateMagicBytes } from "../../utils/fileValidation.js";
import { bookService } from "../../services/book.service.js";
import { createNewBookNotification } from "../notificationController.js";
import { APIError, catchAsync } from "../../middlewares/errorHandler.js";

// Magic-byte types accepted for the book's text file.
const BOOK_FILE_MIME_TYPES = ["application/pdf", "application/epub+zip"];

//cretae a book
export const createBook = async (req, res) => {
  logger.info("Creating book with data:", req.body);
  logger.info("Files received:", req.files);
  try {
    const { title, category, price, readCount, description, duration } = req.body;

    const hasTextFile = Boolean(req.files?.file?.length);
    const hasAudioFile = Boolean(req.files?.audio?.length);

    if (!req.files || !req.files.thumbnail || (!hasTextFile && !hasAudioFile))
      return res
        .status(400)
        .json({ error: "Thumbnail image and a book file (PDF/EPUB) or audio file (MP3/M4A) are required" });

    if (!req.user || !req.user.name) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, user not found or missing name",
      });
    }

    const isThumbnailValid = await validateMagicBytes(req.files.thumbnail[0].buffer, ["image/jpeg", "image/png", "image/webp"]);
    if (!isThumbnailValid) {
      return res.status(400).json({ success: false, message: "Invalid file content detected. Magic bytes do not match expected types.", data: null });
    }

    if (hasTextFile) {
      const isFileValid = await validateMagicBytes(req.files.file[0].buffer, BOOK_FILE_MIME_TYPES);
      if (!isFileValid) {
        return res.status(400).json({ success: false, message: "Invalid file content detected. Magic bytes do not match expected types.", data: null });
      }
    }

    // Upload thumbnail to Cloudinary
    const thumbnailUpload = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "library-books/thumbnails" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.files.thumbnail[0].buffer);
    });

    let fileUpload = null;
    if (hasTextFile) {
      // Upload book file to Cloudinary (as raw file)
      fileUpload = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "library-books/files", resource_type: "raw", type: "authenticated" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.files.file[0].buffer);
      });
    }

    // Optional audiobook track (MP3/M4A) uploaded alongside the text file.
    let audioUpload = null;
    if (hasAudioFile) {
      try {
        audioUpload = await bookService.uploadAudio({
          buffer: req.files.audio[0].buffer,
        });
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message, data: null });
      }
    }

    // Debug: log Cloudinary upload results
    logger.info("thumbnailUpload:", thumbnailUpload);
    logger.info("fileUpload:", fileUpload);

    const book = await Book.create({
      title,
      author: req.user._id,
      thumbnail: thumbnailUpload.secure_url,
      category,
      price,
      description,
      readCount,
      image: thumbnailUpload.secure_url,
      ...(fileUpload && { fileUrl: fileUpload.secure_url, filePublicId: fileUpload.public_id }),
      ...(audioUpload && {
        audioFileUrl: audioUpload.secureUrl,
        audioFilePublicId: audioUpload.publicId,
        duration: audioUpload.duration || parseDuration(duration),
      }),
    });

    
    // Emit new book notification asynchronously to followers
    createNewBookNotification(book._id, req.user._id, book.title).catch((err) =>
      logger.error("Error creating book notification:", err)
    );
    
    res.status(201).json({ success: true, message: "Book created successfully", data: book });
    
      } catch (err) {
    logger.error("Book creation error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// get all books in the store
export const getBooks = async (req, res) => {
  const books = await Book.find().populate("author", "name avatar bio").populate("reviews.user", "name avatar");
  res.status(200).json({ success: true, data: books });
};

// get a particular book
export const getBook = async (req, res) => {
  const book = await Book.findById(req.params.id)
    .populate("author", "name avatar bio")
    .populate("reviews.user", "name avatar");
  if (!book) return res.status(404).json({ success: false, message: "Book not found" });
  res.status(200).json({ success: true, data: book });
};

// get books created by the author
export const getBooksByAuthor = async (req, res) => {
  try {
    const { authorId } = req.params; // Get authorId from route params
    if (!authorId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing author id" });
    }
    const books = await Book.find({ author: authorId }).populate("author", "name avatar bio");
    // An empty result set is a successful query, not a failure.
    res.status(200).json({ success: true, data: books || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// delete book by id
export const deleteBook = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new APIError("Invalid book id", 400));
  }

  const book = req.resource || (await Book.findById(id));
  if (!book) {
    return next(new APIError("Book not found", 404));
  }

  const isOwner =
    req.user?._id && book.author?.toString() === req.user._id.toString();
  const isAdmin = req.user?.role === "admin";
  if (!isOwner && !isAdmin) {
    return next(
      new APIError("You are not authorized to delete this book", 403)
    );
  }

  await Book.findByIdAndDelete(book._id);
  res.status(200).json({
    success: true,
    message: "Book deleted",
    data: null,
  });
});

// Upload (or replace) the audiobook audio for an existing book.
// Ownership is enforced by authorizeOwnership middleware before this handler.
export const uploadBookAudio = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { duration } = req.body;

  const book = req.resource || (await Book.findById(id));
  if (!book) {
    return next(new APIError("Book not found", 404));
  }

  if (!req.file) {
    return next(new APIError("Audio file is required", 400));
  }

  const audioUpload = await bookService.uploadAudio({ buffer: req.file.buffer });
  const updated = await bookService.attachAudio({
    bookId: id,
    audioFileUrl: audioUpload.secureUrl,
    audioFilePublicId: audioUpload.publicId,
    duration: audioUpload.duration || parseDuration(duration),
  });

  res.status(200).json({
    success: true,
    message: "Audiobook audio uploaded successfully",
    data: {
      _id: updated._id,
      title: updated.title,
      audioFileUrl: updated.audioFileUrl,
      duration: updated.duration,
    },
  });
});

// Stream (or redirect to a signed URL for) the audiobook audio. Access control
// mirrors streamBookPreview: free books, the author, and purchasers may listen.
export const streamBookAudio = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Missing book id" });
    }

    const book = await Book.findById(id).populate("author", "_id");
    if (!book || !book.audioFileUrl) {
      return res
        .status(404)
        .json({ success: false, message: "Audiobook audio not found" });
    }

    let hasAccess = book.price === 0;

    if (userId) {
      if (book.author?._id?.toString() === userId.toString()) {
        hasAccess = true;
      } else {
        const user = await User.findById(userId).select("purchasedBooks");
        if (user?.purchasedBooks?.some((entry) => entry.bookId.toString() === id)) {
          hasAccess = true;
        }
      }
    }

    if (!hasAccess) {
      return res
        .status(403)
        .json({ success: false, message: "You do not have access to this book." });
    }

    // Authenticated uploads are served through a short-lived signed URL, which
    // the player follows directly (Cloudinary supports HTTP Range requests).
    if (book.audioFilePublicId) {
      const signedUrl = bookService.getSignedAudioUrl(book);
      return res.redirect(302, signedUrl);
    }

    // Fallback for public (non-authenticated) audio URLs: proxy the stream and
    // forward Range headers so seeking works.
    const rangeHeader = req.headers.range || "bytes=0-";
    const fileResponse = await axios.get(book.audioFileUrl, {
      responseType: "stream",
      headers: { Range: rangeHeader },
    });

    res.setHeader("Content-Type", fileResponse.headers["content-type"] || "audio/mpeg");
    if (fileResponse.headers["content-range"]) {
      res.setHeader("Content-Range", fileResponse.headers["content-range"]);
      res.status(206);
    }
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(`${book.title}.mp3`)}"`
    );
    res.setHeader("Cache-Control", "private, max-age=0, no-cache");

    fileResponse.data.pipe(res);
  } catch (error) {
    logger.error("Error streaming audiobook audio:", error);
    res
      .status(500)
      .json({ success: false, message: "Unable to stream audiobook audio" });
  }
};

// Parse an optional user-supplied duration (seconds). Returns 0 when absent or
// not a positive finite number.
const parseDuration = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

// review books

export {
  addBookReview,
  getBookReviews,
  updateBookReview,
  deleteBookReview,
} from "../reviewController.js";

// recommended books for user based on their profile interest
export const fetchRecommendedBooks = async (req, res) => {
  try {
    const rawInterests = req.query?.interests ?? req.body?.interests;

    let interests = [];
    if (typeof rawInterests === "string") {
      interests = rawInterests
        .split(",")
        .map((i) => i.trim())
        .filter(Boolean);
    } else if (Array.isArray(rawInterests)) {
      interests = rawInterests
        .filter((i) => typeof i === "string")
        .map((i) => i.trim())
        .filter(Boolean);
    } else if (rawInterests !== undefined && rawInterests !== null) {
      return res.status(400).json({
        success: false,
        message: "Interests must be an array of strings or comma-separated string",
      });
    }

    const hasInterests = interests.length > 0;

    if (!hasInterests) {
      const books = await Book.find()
        .populate("author", "name email avatar")
        .sort({ readCount: -1 })
        .limit(10);

      return res.status(200).json({
        success: true,
        recommended: books,
        books,
        message: "Popular books",
      });
    }

    const recommended = await Book.find({
      category: { $in: interests },
    })
      .populate("author", "name email avatar")
      .sort({ readCount: -1 })
      .limit(10);

    return res.status(200).json({
      success: true,
      recommended,
      books: recommended,
      message: "Books recommended based on your interests",
    });
  } catch (error) {
    logger.error("Error fetching recommended books:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error fetching recommended books",
    });
  }
};

export const streamBookPreview = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Missing book id" });
    }

    const book = await Book.findById(id).populate("author", "_id");
    if (!book || !book.fileUrl) {
      return res
        .status(404)
        .json({ success: false, message: "Book file not found" });
    }

    let hasAccess = book.price === 0;

    if (userId) {
      if (book.author?._id?.toString() === userId.toString()) {
        hasAccess = true;
      } else {
        const user = await User.findById(userId).select("purchasedBooks");
        if (user?.purchasedBooks?.some((entry) => entry.bookId.toString() === id)) {
          hasAccess = true;
        }
      }
    }

    if (!hasAccess) {
      return res
        .status(403)
        .json({ success: false, message: "You do not have access to this book." });
    }

    if (book.filePublicId) {
      const signedUrl = cloudinary.utils.private_download_url(book.filePublicId, "raw", {
        expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      });
      return res.redirect(302, signedUrl);
    }

    const fileResponse = await axios.get(book.fileUrl, {
      responseType: "stream",
    });

    res.setHeader(
      "Content-Type",
      fileResponse.headers["content-type"] || "application/pdf"
    );
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(`${book.title}.pdf`)}"`
    );
    res.setHeader("Cache-Control", "private, max-age=0, no-cache");

    fileResponse.data.pipe(res);
  } catch (error) {
    logger.error("Error streaming book preview:", error);
    res
      .status(500)
      .json({ success: false, message: "Unable to stream book preview" });
  }
};
