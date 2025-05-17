import Book from "../models/Book.js";
import cloudinary from "../utils/cloudinary.js";

export const createBook = async (req, res) => {
  try {
    const { title, author, category, price, readCount, rating } = req.body;

    if (!req.file)
      return res.status(400).json({ error: "Image file is required" });

    const result = await cloudinary.uploader.upload_stream(
      { folder: "library-books" },
      async (error, result) => {
        if (error) return res.status(500).json({ error: error.message });

        const book = await Book.create({
          title,
          author,
          category,
          price,
          readCount,
          rating,
          image: result.secure_url,
        });

        res.status(201).json(book);
      }
    );

    req.file.stream.pipe(result);
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
