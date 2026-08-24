import mongoose from "mongoose";
import Category from "../models/Category.js";
import Course from "../models/Course.js";
import { deleteCachePattern } from "../utils/cache.js";
import { slugifyCategory, uniqueCategorySlug } from "../services/categoryService.js";

const categoryProjection = {
  name: 1,
  slug: 1,
  description: 1,
  icon: 1,
  image: 1,
  parent: 1,
  order: 1,
};

export const listCategories = async (_req, res) => {
  const categories = await Category.aggregate([
    { $match: { isActive: true } },
    {
      $lookup: {
        from: "courses",
        localField: "_id",
        foreignField: "categoryRef",
        as: "courses",
      },
    },
    {
      $addFields: {
        courseCount: { $size: "$courses" },
        enrollmentCount: {
          $sum: {
            $map: { input: "$courses", as: "course", in: { $size: { $ifNull: ["$$course.enrolledUsers", []] } } },
          },
        },
        freeCount: {
          $size: { $filter: { input: "$courses", as: "course", cond: { $eq: ["$$course.price", 0] } } },
        },
        paidCount: {
          $size: { $filter: { input: "$courses", as: "course", cond: { $gt: ["$$course.price", 0] } } },
        },
        minPrice: { $cond: [{ $gt: [{ $size: "$courses" }, 0] }, { $min: "$courses.price" }, null] },
        maxPrice: { $cond: [{ $gt: [{ $size: "$courses" }, 0] }, { $max: "$courses.price" }, null] },
      },
    },
    { $project: { ...categoryProjection, courseCount: 1, enrollmentCount: 1, freeCount: 1, paidCount: 1, minPrice: 1, maxPrice: 1 } },
    { $sort: { order: 1, name: 1 } },
  ]);
  res.json({ success: true, categories });
};

export const getCategory = async (req, res) => {
  const category = await Category.findOne({ slug: slugifyCategory(req.params.slug), isActive: true })
    .select(categoryProjection)
    .lean();
  if (!category) return res.status(404).json({ success: false, message: "Category not found" });

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const sorts = { newest: { createdAt: -1 }, popular: { enrolledUsers: -1 }, price: { price: 1 } };
  const sort = sorts[req.query.sort] || sorts.newest;
  const filter = { categoryRef: category._id };
  const [courses, total] = await Promise.all([
    Course.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).populate("createdBy", "name avatar"),
    Course.countDocuments(filter),
  ]);
  res.json({ success: true, category, courses, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
};

export const createCategory = async (req, res) => {
  const { name, description, icon, image, parent, order, isActive } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, message: "Category name is required" });
  const duplicate = await Category.exists({ name: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
  if (duplicate) return res.status(409).json({ success: false, message: "Category name already exists" });
  if (parent) {
    const parentCategory = await Category.findById(parent);
    if (!parentCategory || parentCategory.parent) return res.status(400).json({ success: false, message: "Parent must be a top-level category" });
  }
  const category = await Category.create({ name: name.trim(), slug: await uniqueCategorySlug(name), description, icon, image, parent: parent || null, order, isActive });
  await deleteCachePattern("categories:*");
  res.status(201).json({ success: true, category });
};

export const updateCategory = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid category id" });
  const category = await Category.findById(req.params.id);
  if (!category) return res.status(404).json({ success: false, message: "Category not found" });
  const allowed = ["description", "icon", "image", "order", "isActive"];
  for (const field of allowed) if (req.body[field] !== undefined) category[field] = req.body[field];
  if (req.body.name && req.body.name.trim() !== category.name) {
    category.name = req.body.name.trim();
    category.slug = await uniqueCategorySlug(category.name, category._id);
  }
  if (req.body.parent !== undefined) {
    if (req.body.parent) {
      const parent = await Category.findById(req.body.parent);
      if (!parent || parent.parent || parent._id.equals(category._id)) return res.status(400).json({ success: false, message: "Invalid parent category" });
    }
    category.parent = req.body.parent || null;
  }
  await category.save();
  await Promise.all([deleteCachePattern("categories:*"), deleteCachePattern("courses:*")]);
  res.json({ success: true, category });
};

export const deleteCategory = async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) return res.status(404).json({ success: false, message: "Category not found" });
  const courseCount = await Course.countDocuments({ categoryRef: category._id });
  if (courseCount > 0) {
    category.isActive = false;
    await category.save();
  } else {
    await category.deleteOne();
  }
  await Promise.all([deleteCachePattern("categories:*"), deleteCachePattern("courses:*")]);
  res.json({ success: true, softDeleted: courseCount > 0 });
};
