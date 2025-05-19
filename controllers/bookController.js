import Book from "../models/Book.js";
import cloudinary from "../utils/cloudinary.js";

export const createBook = async (req, res) => {
  try {
    const { title, category, price, readCount, rating } = req.body;

    if (!req.files || !req.files.thumbnail || !req.files.file)
      return res
        .status(400)
        .json({ error: "Thumbnail image and book file are required" });

    // Upload thumbnail to Cloudinary
    const thumbnailUpload = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "library-books/thumbnails" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      req.files.thumbnail[0].stream.pipe(stream);
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
      req.files.file[0].stream.pipe(stream);
    });

    const book = await Book.create({
      title,
      author: req.user.name,
      category,
      price,
      readCount,
      rating,
      image: thumbnailUpload.secure_url,
      fileUrl: fileUpload.secure_url,
    });

    res.status(201).json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getBooks = async (req, res) => {
  const books = await Book.find();
  res.json(books);
};

export const getBook = async (req, res) => {
  const book = await Book.findById(req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.json(book);
};

export const deleteBook = async (req, res) => {
  await Book.findByIdAndDelete(req.params.id);
  res.json({ message: "Book deleted" });
};
