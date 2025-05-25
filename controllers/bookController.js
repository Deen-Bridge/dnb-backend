import Book from "../models/Book.js";
import cloudinary from "../utils/cloudinary.js";

export const createBook = async (req, res) => {
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
      stream.end(req.files.thumbnail[0].buffer); // Use buffer, not .stream.pipe
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
      stream.end(req.files.file[0].buffer); // Use buffer, not .stream.pipe
    });

    // Debug: log Cloudinary upload results
    console.log("thumbnailUpload:", thumbnailUpload);
    console.log("fileUpload:", fileUpload);

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
    console.error("Book creation error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getBooks = async (req, res) => {
  const books = await Book.find().populate("author"); // populate all author fields
  res.json(books);
};

export const getBook = async (req, res) => {
  const book = await Book.findById(req.params.id).populate("author","name email avatar"); // populate all author fields
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.json(book);
};

// ...existing code...
export const getBooksByAuthor = async (req, res) => {
  try {
    const { authorId } = req.params; // Get authorId from route params
    if (!authorId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing author id" });
    }
    const books = await Book.find({ author: authorId });
    res.status(200).json({ success: true, books });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// ...existing code...
export const deleteBook = async (req, res) => {
  await Book.findByIdAndDelete(req.params.id);
  res.json({ message: "Book deleted" });
};
