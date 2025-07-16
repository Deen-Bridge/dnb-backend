import Course from "../models/Course.js";
import Book from "../models/Book.js";
import User from "../models/User.js";
import Space from "../models/Space.js";
import Reel from "../models/Reel.js";
import mongoose from "mongoose";

export const searchAll = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim() === "") {
      return res.status(400).json({ error: "Query string is required." });
    }
    const queryRegex = new RegExp(q.trim(), "i");
    console.log("Search query:", q);


    // Search Courses
    const courses = await Course.find({ title: queryRegex })
      .select("_id title description  price thumbnail")
      .lean();
    console.log("Courses found:", courses);
    // Search Books
    const books = await Book.find({ title: queryRegex })
      .select("_id title description  price image author")
      .lean();
    console.log("Books found:", books);
    // Search Users
    const users = await User.find({ name: queryRegex })
      .select("_id name email avatar role ")
      .lean();
    console.log("Users found:", users);
    // Search Spaces
    const spaces = await Space.find({ title: queryRegex })
      .select(
        "_id title description  price status eventDate duration host"
      )
      .lean();
    console.log("Spaces found:", spaces);
    // Search Reels (by description)
    const reels = await Reel.find({ description: queryRegex })
      .select("_id description createdBy")
      .lean();
    console.log("Reels found:", reels);

    const results = [
      ...courses.map((c) => ({
        type: "course",
        id: c._id,
        title: c.title,
        description: c.description,
        price: c.price,
        thumbnail: c.thumbnail,
      })),
      ...books.map((b) => ({
        type: "book",
        id: b._id,
        title: b.title,
        description: b.description,
        category: b.category,
        price: b.price,
        image: b.image,
        author: b.author,
      })),
      ...users.map((u) => ({
        type: "user",
        id: u._id,
        name: u.name,
        avatar: u.avatar,
        role: u.role,
      })),
      ...spaces.map((s) => ({
        type: "space",
        id: s._id,
        title: s.title,
        description: s.description,
        price: s.price,
        status: s.status,
        eventDate: s.eventDate,
        duration: s.duration,
        host: s.host,
      })),
      ...reels.map((r) => ({
        type: "reel",
        id: r._id,
        description: r.description,
      })),
    ];

    res.json(results);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
};
