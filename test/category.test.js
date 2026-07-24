import 'dotenv/config';
import mongoose from 'mongoose';
import Category, { slugify, generateUniqueSlug } from '../src/models/Category.js';

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Category.deleteMany({});
});

describe('Category Model', () => {
  describe('Slug Generation Helpers', () => {
    it('slugify handles diacritics and apostrophes correctly', () => {
      expect(slugify("Qur'an")).toBe('quran');
      expect(slugify('Tafsīr')).toBe('tafsir');
      expect(slugify('Islamic Finance')).toBe('islamic-finance');
      expect(slugify('  Messy   Name  ')).toBe('messy-name');
    });

    it('generateUniqueSlug appends suffixes on collision', async () => {
      const existing = ['quran', 'quran-2'];
      const checker = async (slug) => existing.includes(slug);
      
      const result = await generateUniqueSlug("Qur'an", checker);
      expect(result).toBe('quran-3');
    });
  });

  describe('Model Pre-save Hook', () => {
    it('generates a slug automatically if not provided', async () => {
      const category = await Category.create({ name: 'Aqeedah' });
      expect(category.slug).toBe('aqeedah');
    });

    it('generates unique slugs on collision (different names, same slug)', async () => {
      const cat1 = await Category.create({ name: "Qur'an" });
      expect(cat1.slug).toBe('quran');

      // "Quran" resolves to "quran", which is taken. It should get a suffix.
      const cat2 = await Category.create({ name: 'Quran' });
      expect(cat2.slug).toBe('quran-2');
    });

    it('enforces name uniqueness at the DB level', async () => {
      await Category.create({ name: 'Seerah' });
      
      let error;
      try {
        await Category.create({ name: 'Seerah' });
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe(11000); // MongoDB duplicate key error code
    });

    it('enforces slug uniqueness at the DB level (if set manually)', async () => {
      await Category.create({ name: 'Test1', slug: 'test' });
      
      let error;
      try {
        await Category.create({ name: 'Test2', slug: 'test' });
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe(11000);
    });
  });
});
