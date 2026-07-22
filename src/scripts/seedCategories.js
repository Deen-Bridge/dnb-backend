import 'dotenv/config';
import mongoose from 'mongoose';
import Category, { slugify } from '../models/Category.js';

const coreCategories = [
  { name: "Qur'an", description: "The central religious text of Islam.", order: 10 },
  { name: "Tajweed", description: "Rules of Qur'anic recitation.", order: 11, parentName: "Qur'an" },
  { name: "Tafsir", description: "Exegesis and interpretation of the Qur'an.", order: 12, parentName: "Qur'an" },
  { name: "Hadith", description: "Record of the words, actions, and the silent approval of the Islamic prophet Muhammad.", order: 20 },
  { name: "Aqeedah", description: "Islamic creed and belief system.", order: 30 },
  { name: "Fiqh", description: "Islamic jurisprudence.", order: 40 },
  { name: "Seerah/History", description: "Life of the Prophet and Islamic history.", order: 50 },
  { name: "Arabic Language", description: "Classical and modern Arabic studies.", order: 60 },
  { name: "Islamic Finance", description: "Islamic banking, economics, and finance.", order: 70 },
  { name: "Spirituality/Tazkiyah", description: "Purification of the soul and spiritual development.", order: 80 },
];

export async function seedCategories(silent = false) {
  let countCreated = 0;
  let countUpdated = 0;

  const parentIdMap = new Map();
  const parents = coreCategories.filter(c => !c.parentName);
  const children = coreCategories.filter(c => c.parentName);

  async function processCategory(catData) {
    const targetSlug = slugify(catData.name);
    let category = await Category.findOne({ slug: targetSlug });
    
    let parentId = null;
    if (catData.parentName) {
      parentId = parentIdMap.get(slugify(catData.parentName));
    }

    if (!category) {
      // Create new
      category = new Category({
        name: catData.name,
        slug: targetSlug, // Set slug explicitly so it doesn't need to generate one
        description: catData.description,
        order: catData.order,
        parent: parentId,
        isActive: true,
      });
      await category.save();
      countCreated++;
    } else {
      // Update existing
      category.name = catData.name;
      category.description = catData.description;
      category.order = catData.order;
      category.parent = parentId;
      category.isActive = true;
      await category.save();
      countUpdated++;
    }
    parentIdMap.set(targetSlug, category._id);
  }

  for (const cat of parents) {
    await processCategory(cat);
  }

  for (const cat of children) {
    await processCategory(cat);
  }

  if (!silent) {
    console.log('--- Category Seed Summary ---');
    console.log(`Created: ${countCreated}`);
    console.log(`Updated: ${countUpdated}`);
    console.log(`Total processed: ${countCreated + countUpdated}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('seedCategories.js')) {
  mongoose.connect(process.env.MONGO_URI).then(async () => {
    await seedCategories();
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
