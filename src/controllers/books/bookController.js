import axios from "axios";
import Book from "../../models/Book.js";
import User from "../../models/User.js";
import cloudinary from "../../utils/cloudinary.js";
import logger from "../../config/logger.js";

//cretae a book
export const createBook = async (req, res) => {
  logger.info("Creating book with data:", req.body);
  logger.info("Files received:", req.files);
  try {
    const { title, category, price, readCount, rating, description } = req.body;

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
        { folder: "library-books/files", resource_type: "raw" },
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
      rating,
      image: thumbnailUpload.secure_url,
      fileUrl: fileUpload.secure_url,
    });

    res.status(201).json({ success: true, book });
  } catch (err) {
    logger.error("Book creation error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// get all books in the store
export const getBooks = async (req, res) => {
  const books = await Book.find().populate("author").populate("reviews.user"); // populate all author fields
  res.json(books);
};

// get a particular book
export const getBook = async (req, res) => {
  const book = await Book.findById(req.params.id)
    .populate("author")
    .populate("reviews.user"); // populate all author fields
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.json(book);
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
    const books = await Book.find({ author: authorId }).populate("author");
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
export const deleteBook = async (req, res) => {
  await Book.findByIdAndDelete(req.params.id);
  res.json({ message: "Book deleted" });
};

// review books

export const addBookReview = async (req, res) => {
  const { rating, comment } = req.body;
  const book = await Book.findById(req.params.id);

  if (!book) {
    return res.status(404).json({ success: false, message: "Book not found" });
  }

  // Optional: Prevent duplicate reviews by the same user
  const alreadyReviewed = book.reviews.find(
    (r) => r.user.toString() === req.user._id.toString()
  );
  if (alreadyReviewed) {
    return res
      .status(400)
      .json({ success: false, message: "Book already reviewed by this user" });
  }

  const review = {
    user: req.user._id,
    comment,
    rating: Number(rating),
  };

  book.reviews.push(review);

  // Optionally update average rating and review count
  book.rating =
    book.reviews.reduce((acc, item) => item.rating + acc, 0) /
    book.reviews.length;

  await book.save();
  res
    .status(201)
    .json({ success: true, message: "Review added", reviews: book.reviews });
};

// recommended books for user based on their profile interest
export const fetchRecommendedBooks = async (req, res) => {
  try {
    const { interests } = req.body;
    const recommmended = await Book.find().$where(category === interests);
    res.status(200).json({ success: true, recommmended });
  } catch (e) {}
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
