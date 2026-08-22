import dotenv from "dotenv";
import mongoose from "mongoose";
import Book from "../models/Book.js";
import Category from "../models/Category.js";
import Course from "../models/Course.js";
import { slugifyCategory, uniqueCategorySlug } from "../services/categoryService.js";

dotenv.config();

export async function migrateCategories() {
  const values = [...new Set([...(await Course.distinct("category")), ...(await Book.distinct("category"))].filter(Boolean))];
  for (const value of values) {
    const base = slugifyCategory(value);
    let category = await Category.findOne({ $or: [{ slug: base }, { name: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }] });
    if (!category) category = await Category.create({ name: value.trim(), slug: await uniqueCategorySlug(value) });
    await Promise.all([
      Course.updateMany({ category: value, categoryRef: { $exists: false } }, { $set: { categoryRef: category._id, category: category.name } }),
      Book.updateMany({ category: value, categoryRef: { $exists: false } }, { $set: { categoryRef: category._id, category: category.name } }),
    ]);
  }
}

if (process.argv[1]?.endsWith("migrateCategories.js")) {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  await migrateCategories();
  await mongoose.disconnect();
}
