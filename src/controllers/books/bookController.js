import axios from "axios";
import mongoose from "mongoose";
import Book from "../../models/Book.js";
import User from "../../models/User.js";
import cloudinary from "../../utils/cloudinary.js";
import logger from "../../config/logger.js";
import { validateMagicBytes } from "../../utils/fileValidation.js";
import { createNewBookNotification } from "../notificationController.js";
import { APIError, catchAsync } from "../../middlewares/errorHandler.js";

//cretae a book
export const createBook = async (req, res) => {
  logger.info("Creating book with data:", req.body);
  logger.info("Files received:", req.files);
  try {
    const { title, category, price, readCount, description } = req.body;

    if (!req.files || !req.files.thumbnail || !req.files.file)
      return res
        .status(400)
        .json({ error: "Thumbnail image and book file are required" });

    if (!req.user || !req.user.name) {
      return res.status(401).json({
        success: false,
        message: "Not authorized, user not found or missing name",
      });
    }

    const isThumbnailValid = await validateMagicBytes(req.files.thumbnail[0].buffer, ["image/jpeg", "image/png", "image/webp"]);
    const isFileValid = await validateMagicBytes(req.files.file[0].buffer, ["application/pdf", "application/epub+zip"]);

    if (!isThumbnailValid || !isFileValid) {
      return res.status(400).json({ success: false, message: "Invalid file content detected. Magic bytes do not match expected types.", data: null });
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

    // Upload book file to Cloudinary (as raw file)
    const fileUpload = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "library-books/files", resource_type: "raw", type: "authenticated" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.files.file[0].buffer);
    });

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
      fileUrl: fileUpload.secure_url,
      filePublicId: fileUpload.public_id,
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
  res.json({ success: true, books });
};

// get a particular book
export const getBook = async (req, res) => {
  const book = await Book.findById(req.params.id)
    .populate("author", "name avatar bio")
    .populate("reviews.user", "name avatar");
  if (!book) return res.status(404).json({ success: false, message: "Book not found" });
  res.json({ success: true, book });
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
    if (!books || books.length === 0) {
      return res
        .status(200)
        .json({ success: false, message: "No books found" });
    }
    res.status(200).json({ success: true, books });
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
    // GET /books/recom — prefer query interests; fall back to body for older clients.
    const raw = req.query?.interests ?? req.body?.interests;
    const interests = Array.isArray(raw)
      ? raw
      : typeof raw === "string" && raw.trim()
        ? raw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

    const filter =
      interests.length > 0
        ? { category: { $in: interests } }
        : {};

    const recommended = await Book.find(filter)
      .sort({ readCount: -1, createdAt: -1 })
      .limit(20)
      .lean();

    return res.status(200).json({ success: true, recommended });
  } catch (e) {
    logger.error("fetchRecommendedBooks failed", e);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch recommended books",
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
