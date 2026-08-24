import dotenv from "dotenv";
import mongoose from "mongoose";
import Category from "../models/Category.js";

dotenv.config();

export const CATEGORY_SEEDS = [
  { name: "Qur'an", slug: "quran", order: 10, children: [{ name: "Tajweed", slug: "tajweed" }, { name: "Tafsir", slug: "tafsir" }] },
  { name: "Hadith", slug: "hadith", order: 20 },
  { name: "Aqeedah", slug: "aqeedah", order: 30 },
  { name: "Fiqh", slug: "fiqh", order: 40 },
  { name: "Seerah / History", slug: "seerah-history", order: 50 },
  { name: "Arabic Language", slug: "arabic-language", order: 60 },
  { name: "Islamic Finance", slug: "islamic-finance", order: 70 },
  { name: "Spirituality / Tazkiyah", slug: "spirituality-tazkiyah", order: 80 },
];

export async function seedCategories() {
  for (const seed of CATEGORY_SEEDS) {
    const parent = await Category.findOneAndUpdate({ slug: seed.slug }, { $set: { name: seed.name, order: seed.order, isActive: true } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    for (const child of seed.children || []) {
      await Category.findOneAndUpdate({ slug: child.slug }, { $set: { name: child.name, parent: parent._id, isActive: true } }, { upsert: true, setDefaultsOnInsert: true });
    }
  }
}

if (process.argv[1]?.endsWith("seedCategories.js")) {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  await seedCategories();
  await mongoose.disconnect();
}
