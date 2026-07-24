import 'dotenv/config';
import mongoose from 'mongoose';
import Course from '../models/Course.js';
import Book from '../models/Book.js';
import Category, { slugify } from '../models/Category.js';

// Canonical core disciplines from Phase 4
const SEED_CATEGORIES = [
  "Qur'an",
  "Hadith",
  "Aqeedah",
  "Fiqh",
  "Seerah/History",
  "Arabic Language",
  "Islamic Finance",
  "Spirituality/Tazkiyah"
];

const canonicalMap = new Map();
for (const cat of SEED_CATEGORIES) {
  canonicalMap.set(slugify(cat), cat);
}

function getCanonicalName(originalName, firstSeenMap) {
  const slug = slugify(originalName);
  if (canonicalMap.has(slug)) {
    return canonicalMap.get(slug);
  }
  if (firstSeenMap.has(slug)) {
    return firstSeenMap.get(slug);
  }
  // Title case it as a fallback
  const titleCased = originalName
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  firstSeenMap.set(slug, titleCased);
  return titleCased;
}

export async function runMigration(silent = false) {
  let categoriesCreated = 0;
  let categoriesMatched = 0;
  let coursesBackfilled = 0;
  let booksBackfilled = 0;
  let unmatched = 0;

  const firstSeenMap = new Map();

  // 1. Get all distinct categories
  const courseCategories = await Course.distinct('category');
  const bookCategories = await Book.distinct('category');
  
  const allDistinct = [...new Set([...courseCategories, ...bookCategories])].filter(Boolean);

  // 2. Process each distinct legacy category string
  for (const legacyName of allDistinct) {
    const canonicalName = getCanonicalName(legacyName, firstSeenMap);
    
    // Find or create category
    let category = await Category.findOne({ name: canonicalName });
    if (!category) {
      category = new Category({ name: canonicalName });
      await category.save(); // pre-save hook handles slug
      categoriesCreated++;
    } else {
      categoriesMatched++;
    }

    // 3. Backfill Courses (only where categoryRef is missing or null)
    const courseResult = await Course.updateMany(
      { 
        category: legacyName, 
        $or: [{ categoryRef: { $exists: false } }, { categoryRef: null }] 
      },
      { $set: { categoryRef: category._id } }
    );
    coursesBackfilled += courseResult.modifiedCount;

    // 4. Backfill Books
    const bookResult = await Book.updateMany(
      { 
        category: legacyName, 
        $or: [{ categoryRef: { $exists: false } }, { categoryRef: null }] 
      },
      { $set: { categoryRef: category._id } }
    );
    booksBackfilled += bookResult.modifiedCount;
  }

  // Find any that didn't match
  const remainingCourses = await Course.countDocuments({ 
    $or: [{ categoryRef: { $exists: false } }, { categoryRef: null }] 
  });
  const remainingBooks = await Book.countDocuments({ 
    $or: [{ categoryRef: { $exists: false } }, { categoryRef: null }] 
  });
  unmatched = remainingCourses + remainingBooks;

  if (!silent) {
    console.log('--- Migration Summary ---');
    console.log(`Categories Created: ${categoriesCreated}`);
    console.log(`Categories Matched: ${categoriesMatched}`);
    console.log(`Courses Backfilled: ${coursesBackfilled}`);
    console.log(`Books Backfilled: ${booksBackfilled}`);
    if (unmatched > 0) {
      console.warn(`WARNING: ${unmatched} documents left without categoryRef!`);
    } else {
      console.log('All documents successfully backfilled.');
    }
  }

  return {
    categoriesCreated,
    categoriesMatched,
    coursesBackfilled,
    booksBackfilled,
    unmatched
  };
}

if (process.argv[1] && process.argv[1].endsWith('migrateCategories.js')) {
  mongoose.connect(process.env.MONGO_URI).then(async () => {
    await runMigration();
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
