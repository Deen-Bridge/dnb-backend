import mongoose from "mongoose";
import dotenv from "dotenv";
import Course from "../models/Course.js";
import Book from "../models/Book.js";
import Space from "../models/Space.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("MONGO_URI is required");
  process.exit(1);
}

// This is a placeholder user ObjectId. If you have existing users,
// replace this with a real user ID from your database.
const PLACEHOLDER_USER = new mongoose.Types.ObjectId("6a6bd5bdf43b44b676794be5");

const img = (seed) => `https://picsum.photos/seed/${seed}/800/600`;

const courses = [
  {
    title: "Tafsir Surah Al-Fatiha",
    description: "Detailed explanation of Surah Al-Fatiha with reflections on its profound meanings and daily relevance.",
    category: "Qur'an & Tafsir",
    thumbnail: img("tafsir"),
    price: 0,
    rating: 4.8,
    numReviews: 120,
    createdBy: PLACEHOLDER_USER,
  },
  {
    title: "Seerah of the Prophet ﷺ",
    description: "A comprehensive journey through the life of Prophet Muhammad ﷺ from birth to legacy.",
    category: "Seerah",
    thumbnail: img("seerah"),
    price: 50,
    rating: 4.9,
    numReviews: 200,
    createdBy: PLACEHOLDER_USER,
  },
  {
    title: "Aqeedah Essentials & Tawheed",
    description: "Foundational principles of Islamic creed and monotheism explained simply.",
    category: "Aqidah",
    thumbnail: img("aqeedah"),
    price: 0,
    rating: 4.7,
    numReviews: 80,
    createdBy: PLACEHOLDER_USER,
  },
  {
    title: "Arabic Grammar for Quran",
    description: "Learn essential Arabic grammar rules to understand the Quran directly.",
    category: "Language",
    thumbnail: img("arabic"),
    price: 120,
    rating: 4.6,
    numReviews: 95,
    createdBy: PLACEHOLDER_USER,
  },
  {
    title: "Hadith Sciences & Sahih Selections",
    description: "Introduction to Hadith methodology and study of core Hadith collections.",
    category: "Hadith & Sunnah",
    thumbnail: img("hadith"),
    price: 75,
    rating: 4.8,
    numReviews: 150,
    createdBy: PLACEHOLDER_USER,
  },
  {
    title: "Tajweed for Beginners",
    description: "Master the rules of Quranic recitation with proper pronunciation and articulation.",
    category: "Qur'an & Tafsir",
    thumbnail: img("tajweed"),
    price: 40,
    rating: 4.5,
    numReviews: 60,
    createdBy: PLACEHOLDER_USER,
  },
  {
    title: "Islamic Finance & Zakah",
    description: "Understand halal investing, zakah calculation, and ethical financial practices.",
    category: "Fiqh",
    thumbnail: img("finance"),
    price: 100,
    rating: 4.4,
    numReviews: 45,
    createdBy: PLACEHOLDER_USER,
  },
  {
    title: "Fiqh of Purification & Salah",
    description: "Comprehensive practical course on ritual purity, ablution, and prayer jurisprudence.",
    category: "Fiqh",
    thumbnail: img("fiqh"),
    price: 0,
    rating: 4.9,
    numReviews: 300,
    createdBy: PLACEHOLDER_USER,
  },
  {
    title: "The 99 Names of Allah",
    description: "Memorize and understand the meanings of Asmaul Husna with practical reflections.",
    category: "Spirituality",
    thumbnail: img("asmaul-husna"),
    price: 0,
    rating: 4.7,
    numReviews: 180,
    createdBy: PLACEHOLDER_USER,
  },
  {
    title: "Islamic Parenting",
    description: "Raising righteous children in today's world with Islamic principles.",
    category: "Family",
    thumbnail: img("parenting"),
    price: 50,
    rating: 4.6,
    numReviews: 90,
    createdBy: PLACEHOLDER_USER,
  },
];

const books = [
  {
    title: "The Noble Qur'an: English Translation",
    author: PLACEHOLDER_USER,
    category: "Qur'an & Tafsir",
    price: 0,
    description: "Clear English translation of the Qur'an with explanatory notes and commentary.",
    image: img("quran-en"),
    fileUrl: "https://example.com/books/quran-en.pdf",
    rating: 4.9,
    numReviews: 500,
    readCount: 15000,
  },
  {
    title: "Riyad us-Saliheen",
    author: PLACEHOLDER_USER,
    category: "Hadith & Sunnah",
    price: 25,
    description: "A compilation of authentic Hadith on Islamic ethics, manners, and spiritual development.",
    image: img("riyad"),
    fileUrl: "https://example.com/books/riyad-salihin.pdf",
    rating: 4.8,
    numReviews: 350,
    readCount: 8000,
  },
  {
    title: "Fortress of the Muslim",
    author: PLACEHOLDER_USER,
    category: "Duas & Dhikr",
    price: 10,
    description: "Comprehensive collection of authentic supplications and remembrances from the Quran and Sunnah.",
    image: img("fortress"),
    fileUrl: "https://example.com/books/fortress-muslim.pdf",
    rating: 4.7,
    numReviews: 280,
    readCount: 12000,
  },
  {
    title: "The Sealed Nectar",
    author: PLACEHOLDER_USER,
    category: "Seerah",
    price: 30,
    description: "Award-winning biography of Prophet Muhammad ﷺ with detailed historical research.",
    image: img("sealed-nectar"),
    fileUrl: "https://example.com/books/sealed-nectar.pdf",
    rating: 4.9,
    numReviews: 420,
    readCount: 20000,
  },
  {
    title: "Al-Adab al-Mufrad",
    author: PLACEHOLDER_USER,
    category: "Hadith & Sunnah",
    price: 20,
    description: "Imam Bukhari's collection of Hadith on Islamic manners and character.",
    image: img("adab"),
    fileUrl: "https://example.com/books/adab-mufrad.pdf",
    rating: 4.6,
    numReviews: 150,
    readCount: 5000,
  },
  {
    title: "Tafsir Ibn Kathir (Abridged)",
    author: PLACEHOLDER_USER,
    category: "Qur'an & Tafsir",
    price: 45,
    description: "One of the most widely accepted Tafsir works explaining the Quran.",
    image: img("tafsir-kathir"),
    fileUrl: "https://example.com/books/tafsir-ibn-kathir.pdf",
    rating: 4.8,
    numReviews: 310,
    readCount: 9000,
  },
  {
    title: "Bulugh al-Maram",
    author: PLACEHOLDER_USER,
    category: "Fiqh",
    price: 15,
    description: "Ibn Hajar's compilation of Hadith used as basis for Fiqh rulings.",
    image: img("bulugh"),
    fileUrl: "https://example.com/books/bulugh-maram.pdf",
    rating: 4.5,
    numReviews: 120,
    readCount: 6000,
  },
  {
    title: "Healing with the Quran",
    author: PLACEHOLDER_USER,
    category: "Spirituality",
    price: 0,
    description: "Understanding the spiritual and physical healing properties of Quranic recitation.",
    image: img("healing"),
    fileUrl: "https://example.com/books/healing-quran.pdf",
    rating: 4.7,
    numReviews: 200,
    readCount: 7500,
  },
  {
    title: "Stories of the Prophets",
    author: PLACEHOLDER_USER,
    category: "Islamic History",
    price: 35,
    description: "Comprehensive accounts of the prophets mentioned in the Quran.",
    image: img("prophets"),
    fileUrl: "https://example.com/books/stories-prophets.pdf",
    rating: 4.8,
    numReviews: 280,
    readCount: 11000,
  },
  {
    title: "The Path of the Seeker",
    author: PLACEHOLDER_USER,
    category: "Spirituality",
    price: 0,
    description: "A guide for spiritual seekers on the path to Allah through purification of the soul.",
    image: img("seeker"),
    fileUrl: "https://example.com/books/path-seeker.pdf",
    rating: 4.6,
    numReviews: 95,
    readCount: 3500,
  },
];

const now = new Date();
const meetingId = (i) => `deenbridge-seed-space-${i}-${Math.random().toString(36).slice(2, 8)}`;
const spaces = [
  {
    title: "Qur'an Study Circle",
    description: "Weekly group study and reflection on selected Qur'anic verses. Open to all levels.",
    category: "Qur'an & Tafsir",
    thumbnail: img("quran-circle"),
    host: PLACEHOLDER_USER,
    price: 0,
    status: "live",
    eventDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    eventTime: "18:00",
    duration: 60,
    meetingRoom: meetingId(1),
    meetingUrl: `https://meet.jit.si/${meetingId(1)}`,
  },
  {
    title: "Fiqh Q&A Session",
    description: "Open floor for questions on Islamic jurisprudence and daily practice.",
    category: "Fiqh",
    thumbnail: img("fiqh-qa"),
    host: PLACEHOLDER_USER,
    price: 0,
    status: "upcoming",
    eventDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
    eventTime: "20:00",
    duration: 90,
    meetingRoom: meetingId(2),
    meetingUrl: `https://meet.jit.si/${meetingId(2)}`,
  },
  {
    title: "Sisters' Halaqa",
    description: "Weekly gathering for sisters to learn and connect in a safe environment.",
    category: "For Sisters",
    thumbnail: img("sisters"),
    host: PLACEHOLDER_USER,
    price: 0,
    status: "upcoming",
    eventDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    eventTime: "15:00",
    duration: 60,
    meetingRoom: meetingId(3),
    meetingUrl: `https://meet.jit.si/${meetingId(3)}`,
  },
  {
    title: "Hadith Memorization Group",
    description: "Structured program to memorize and understand authentic Hadith with explanations.",
    category: "Hadith & Sunnah",
    thumbnail: img("hadith-group"),
    host: PLACEHOLDER_USER,
    price: 25,
    status: "upcoming",
    eventDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
    eventTime: "19:30",
    duration: 75,
    meetingRoom: meetingId(4),
    meetingUrl: `https://meet.jit.si/${meetingId(4)}`,
  },
  {
    title: "Arabic Conversation Practice",
    description: "Practice spoken Arabic in a supportive environment for all skill levels.",
    category: "Language",
    thumbnail: img("arabic-practice"),
    host: PLACEHOLDER_USER,
    price: 10,
    status: "live",
    eventDate: new Date(now.getTime() + 12 * 60 * 60 * 1000),
    eventTime: "17:00",
    duration: 45,
    meetingRoom: meetingId(5),
    meetingUrl: `https://meet.jit.si/${meetingId(5)}`,
  },
  {
    title: "Tazkiyah: Purification of the Heart",
    description: "Exploring spiritual diseases and their cures based on classical Islamic works.",
    category: "Spirituality",
    thumbnail: img("tazkiyah"),
    host: PLACEHOLDER_USER,
    price: 0,
    status: "live",
    eventDate: new Date(now.getTime() + 36 * 60 * 60 * 1000),
    eventTime: "21:00",
    duration: 60,
    meetingRoom: meetingId(6),
    meetingUrl: `https://meet.jit.si/${meetingId(6)}`,
  },
  {
    title: "Youth Mentorship Circle",
    description: "Guidance and mentorship for young Muslims navigating modern challenges.",
    category: "For Youth",
    thumbnail: img("youth"),
    host: PLACEHOLDER_USER,
    price: 0,
    status: "upcoming",
    eventDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    eventTime: "16:00",
    duration: 120,
    meetingRoom: meetingId(7),
    meetingUrl: `https://meet.jit.si/${meetingId(7)}`,
  },
  {
    title: "Islamic Marriage Workshop",
    description: "Practical guidance on marriage in Islam from engagement to daily life.",
    category: "Family",
    thumbnail: img("marriage"),
    host: PLACEHOLDER_USER,
    price: 50,
    status: "upcoming",
    eventDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    eventTime: "14:00",
    duration: 180,
    meetingRoom: meetingId(8),
    meetingUrl: `https://meet.jit.si/${meetingId(8)}`,
  },
  {
    title: "Seerah Stories for Children",
    description: "Engaging sessions teaching children about the life of Prophet Muhammad ﷺ.",
    category: "For Children",
    thumbnail: img("children"),
    host: PLACEHOLDER_USER,
    price: 0,
    status: "live",
    eventDate: new Date(now.getTime() + 48 * 60 * 60 * 1000),
    eventTime: "10:00",
    duration: 45,
    meetingRoom: meetingId(9),
    meetingUrl: `https://meet.jit.si/${meetingId(9)}`,
  },
  {
    title: "Dawah & Outreach Training",
    description: "Learn effective ways to share Islam with others in today's diverse society.",
    category: "Dawah & Outreach",
    thumbnail: img("dawah"),
    host: PLACEHOLDER_USER,
    price: 0,
    status: "upcoming",
    eventDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
    eventTime: "18:30",
    duration: 90,
    meetingRoom: meetingId(10),
    meetingUrl: `https://meet.jit.si/${meetingId(10)}`,
  },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const courseCount = await Course.countDocuments();
  const bookCount = await Book.countDocuments();
  const spaceCount = await Space.countDocuments();

  console.log(`Existing data — Courses: ${courseCount}, Books: ${bookCount}, Spaces: ${spaceCount}`);

  if (courseCount > 0) {
    console.log("Clearing existing courses...");
    await Course.deleteMany({});
  }
  if (bookCount > 0) {
    console.log("Clearing existing books...");
    await Book.deleteMany({});
  }
  if (spaceCount > 0) {
    console.log("Clearing existing spaces...");
    await Space.deleteMany({});
  }

  const seededCourses = await Course.insertMany(courses);
  console.log(`Seeded ${seededCourses.length} courses`);

  const seededBooks = await Book.insertMany(books);
  console.log(`Seeded ${seededBooks.length} books`);

  const seededSpaces = await Space.insertMany(spaces);
  console.log(`Seeded ${seededSpaces.length} spaces`);

  await mongoose.disconnect();
  console.log("Done");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
