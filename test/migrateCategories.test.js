import 'dotenv/config';
import mongoose from 'mongoose';
import Course from '../src/models/Course.js';
import Book from '../src/models/Book.js';
import Category from '../src/models/Category.js';
import User from '../src/models/User.js';
import { runMigration } from '../src/scripts/migrateCategories.js';

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Category.deleteMany({});
  await Course.deleteMany({});
  await Book.deleteMany({});
  await User.deleteMany({});
});

describe('Migration Script: Categories', () => {
  it('is idempotent and correctly backfills data', async () => {
    // 1. Seed fixture data
    const user = await User.create({
      name: 'Test Author',
      email: 'test@example.com',
      password: 'password123',
    });

    // Courses with mixed casings
    await Course.create({ title: 'Course 1', description: 'desc', category: "Qur'an", createdBy: user._id });
    await Course.create({ title: 'Course 2', description: 'desc', category: 'Quran', createdBy: user._id });
    await Course.create({ title: 'Course 3', description: 'desc', category: 'quran', createdBy: user._id });
    
    // Books with unrelated category
    await Book.create({ title: 'Book 1', author: user._id, description: 'desc', image: 'url', fileUrl: 'url', category: 'fIqH' });
    
    // Unrelated fallback category
    await Course.create({ title: 'Course 4', description: 'desc', category: 'random topic', createdBy: user._id });

    // 2. First Run
    const run1 = await runMigration(true);
    
    expect(run1.categoriesCreated).toBe(3); // Qur'an, Fiqh, Random Topic
    expect(run1.coursesBackfilled).toBe(4);
    expect(run1.booksBackfilled).toBe(1);
    expect(run1.unmatched).toBe(0);

    const categoriesCount1 = await Category.countDocuments();
    expect(categoriesCount1).toBe(3);

    // Verify canonicalization
    const quranCat = await Category.findOne({ name: "Qur'an" });
    expect(quranCat).toBeTruthy();
    
    const coursesAfter1 = await Course.find({ categoryRef: quranCat._id });
    expect(coursesAfter1.length).toBe(3);

    const quranCoursesRefs = coursesAfter1.map(c => c.categoryRef.toString());

    // 3. Second Run (Idempotency)
    const run2 = await runMigration(true);
    
    expect(run2.categoriesCreated).toBe(0);
    expect(run2.coursesBackfilled).toBe(0);
    expect(run2.booksBackfilled).toBe(0);
    expect(run2.unmatched).toBe(0);

    const categoriesCount2 = await Category.countDocuments();
    expect(categoriesCount2).toBe(3);

    // Ensure categoryRefs didn't change
    const coursesAfter2 = await Course.find({ categoryRef: quranCat._id });
    const quranCoursesRefs2 = coursesAfter2.map(c => c.categoryRef.toString());
    
    expect(quranCoursesRefs).toEqual(quranCoursesRefs2);
  });
});
