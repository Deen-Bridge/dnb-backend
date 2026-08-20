import mongoose from "mongoose";
import Category from "../models/Category.js";

export const slugifyCategory = (value) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const uniqueCategorySlug = async (name, excludeId = null) => {
  const base = slugifyCategory(name) || "category";
  let slug = base;
  let suffix = 2;
  while (
    await Category.exists({
      slug,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
  ) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
};

export const resolveActiveCategory = async (value) => {
  if (!value) return null;
  const query = mongoose.Types.ObjectId.isValid(value)
    ? { _id: value, isActive: true }
    : { slug: slugifyCategory(value), isActive: true };
  return Category.findOne(query);
};

export const getValidCategorySlugs = async () =>
  Category.find({ isActive: true }).sort({ order: 1, name: 1 }).distinct("slug");

export const categoryValidationError = async () => {
  const validSlugs = await getValidCategorySlugs();
  return `Unknown or inactive category. Valid slugs: ${validSlugs.join(", ")}`;
};
