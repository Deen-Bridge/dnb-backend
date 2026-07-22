import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Course from '../models/Course.js';
import { catchAsync } from '../middlewares/errorHandler.js';

export const getCategories = catchAsync(async (req, res) => {
  const categories = await Category.aggregate([
    { $match: { isActive: true } },
    {
      $lookup: {
        from: 'courses',
        localField: '_id',
        foreignField: 'categoryRef',
        as: 'courses'
      }
    },
    {
      $project: {
        name: 1,
        slug: 1,
        description: 1,
        icon: 1,
        parent: 1,
        order: 1,
        isActive: 1,
        createdAt: 1,
        updatedAt: 1,
        courseCount: { $size: '$courses' },
        enrollmentCount: {
          $sum: {
            $map: {
              input: '$courses',
              as: 'course',
              in: { $size: { $ifNull: ['$$course.enrolledUsers', []] } }
            }
          }
        },
        freeCount: {
          $size: {
            $filter: {
              input: '$courses',
              as: 'course',
              cond: { $lte: [{ $ifNull: ['$$course.price', 0] }, 0] }
            }
          }
        },
        paidCount: {
          $size: {
            $filter: {
              input: '$courses',
              as: 'course',
              cond: { $gt: [{ $ifNull: ['$$course.price', 0] }, 0] }
            }
          }
        },
        minPrice: {
          $min: {
            $filter: {
              input: {
                $map: {
                  input: '$courses',
                  as: 'course',
                  in: { $ifNull: ['$$course.price', 0] }
                }
              },
              as: 'price',
              cond: { $gt: ['$$price', 0] }
            }
          }
        },
        maxPrice: {
          $max: {
            $map: {
              input: '$courses',
              as: 'course',
              in: { $ifNull: ['$$course.price', 0] }
            }
          }
        }
      }
    },
    { $sort: { order: 1, name: 1 } }
  ]);

  res.status(200).json({ success: true, categories });
});

export const getCategoryBySlug = catchAsync(async (req, res) => {
  const { slug } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const sortParam = req.query.sort || 'newest';
  
  const category = await Category.findOne({ slug, isActive: true }).lean();
  
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }

  const skip = (page - 1) * limit;
  let courses = [];
  
  if (sortParam === 'popular') {
    courses = await Course.aggregate([
      { $match: { categoryRef: category._id } },
      { $addFields: { enrollCount: { $size: { $ifNull: ['$enrolledUsers', []] } } } },
      { $sort: { enrollCount: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'createdBy'
        }
      },
      { $unwind: { path: '$createdBy', preserveNullAndEmptyArrays: true } }
    ]);
    
    courses = courses.map(c => {
      if (c.createdBy) {
        c.createdBy = {
          _id: c.createdBy._id,
          name: c.createdBy.name,
          avatar: c.createdBy.avatar
        };
      }
      return c;
    });
  } else {
    let sort = { createdAt: -1 };
    if (sortParam === 'price') sort = { price: 1 };

    courses = await Course.find({ categoryRef: category._id })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name avatar')
      .lean();
  }

  const total = await Course.countDocuments({ categoryRef: category._id });

  res.status(200).json({ 
    success: true, 
    category,
    courses,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

export const createCategory = catchAsync(async (req, res) => {
  const { name, description, icon, parent, order, isActive } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: 'Name is required' });
  }

  const category = await Category.create({ name, description, icon, parent, order, isActive });
  res.status(201).json({ success: true, category });
});

export const updateCategory = catchAsync(async (req, res) => {
  const { name, slug, description, icon, parent, order, isActive } = req.body;
  
  const category = await Category.findById(req.params.id);
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }

  if (name !== undefined) category.name = name;
  if (slug !== undefined) category.slug = slug;
  if (description !== undefined) category.description = description;
  if (icon !== undefined) category.icon = icon;
  if (parent !== undefined) category.parent = parent;
  if (order !== undefined) category.order = order;
  if (isActive !== undefined) category.isActive = isActive;

  await category.save();

  res.status(200).json({ success: true, category });
});

export const deleteCategory = catchAsync(async (req, res) => {
  const categoryId = req.params.id;
  const category = await Category.findById(categoryId);
  
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }

  const coursesCount = await Course.countDocuments({ categoryRef: categoryId });

  if (coursesCount > 0) {
    category.isActive = false;
    await category.save();
    return res.status(200).json({ 
      success: true, 
      message: 'Category soft-deleted because it has associated courses',
      category
    });
  } else {
    await Category.deleteOne({ _id: categoryId });
    return res.status(200).json({ 
      success: true, 
      message: 'Category hard-deleted because it has no associated courses' 
    });
  }
});
