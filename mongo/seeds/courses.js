// mongo/seeds/courses.js
//
// Seed courses for local development. Every course is created as `published`
// (and carries sections/lessons) so the learning flow is exercisable right
// after seeding. `createdBy` is expected to point at a seeded user.

const img = (seed) => `https://picsum.photos/seed/${seed}/800/600`;

const minimalCourses = [
  {
    title: "Tafsir Surah Al-Fatiha",
    description:
      "Detailed explanation of Surah Al-Fatiha with reflections on its profound meanings and daily relevance.",
    category: "Qur'an & Tafsir",
    thumbnail: img("tafsir"),
    price: 0,
    status: "published",
    sections: [
      {
        title: "Introduction",
        order: 1,
        lessons: [
          { title: "Virtues of the Surah", order: 1, durationSeconds: 300 },
          { title: "Meanings of the verses", order: 2, durationSeconds: 420 },
        ],
      },
    ],
  },
  {
    title: "Seerah of the Prophet ﷺ",
    description:
      "A comprehensive journey through the life of Prophet Muhammad ﷺ from birth to legacy.",
    category: "Seerah",
    thumbnail: img("seerah"),
    price: 50,
    status: "published",
    sections: [
      {
        title: "Early Life",
        order: 1,
        lessons: [
          { title: "Birth and childhood", order: 1, durationSeconds: 600 },
          { title: "The first revelation", order: 2, durationSeconds: 540 },
        ],
      },
    ],
  },
  {
    title: "Tajweed for Beginners",
    description:
      "Master the rules of Quranic recitation with proper pronunciation and articulation.",
    category: "Qur'an & Tafsir",
    thumbnail: img("tajweed"),
    price: 40,
    status: "published",
    sections: [
      {
        title: "Foundations",
        order: 1,
        lessons: [
          { title: "Articulation points", order: 1, durationSeconds: 480 },
          { title: "Rules of noon and meem", order: 2, durationSeconds: 360 },
        ],
      },
    ],
  },
];

const fullCourses = [
  ...minimalCourses,
  {
    title: "Aqeedah Essentials & Tawheed",
    description:
      "Foundational principles of Islamic creed and monotheism explained simply.",
    category: "Aqidah",
    thumbnail: img("aqeedah"),
    price: 0,
    status: "published",
    sections: [
      {
        title: "Core Creed",
        order: 1,
        lessons: [
          { title: "The meaning of Tawheed", order: 1, durationSeconds: 420 },
          { title: "Types of Tawheed", order: 2, durationSeconds: 480 },
        ],
      },
    ],
  },
  {
    title: "Arabic Grammar for Quran",
    description:
      "Learn essential Arabic grammar rules to understand the Quran directly.",
    category: "Language",
    thumbnail: img("arabic"),
    price: 120,
    status: "published",
    sections: [
      {
        title: "Basics",
        order: 1,
        lessons: [
          { title: "Nouns and verbs", order: 1, durationSeconds: 540 },
          { title: "Sentence structure", order: 2, durationSeconds: 600 },
        ],
      },
    ],
  },
  {
    title: "Hadith Sciences & Sahih Selections",
    description:
      "Introduction to Hadith methodology and study of core Hadith collections.",
    category: "Hadith & Sunnah",
    thumbnail: img("hadith"),
    price: 75,
    status: "published",
    sections: [
      {
        title: "Methodology",
        order: 1,
        lessons: [
          { title: "The chain of narration", order: 1, durationSeconds: 420 },
          { title: "Authenticity grading", order: 2, durationSeconds: 480 },
        ],
      },
    ],
  },
  {
    title: "Islamic Finance & Zakah",
    description:
      "Understand halal investing, zakah calculation, and ethical financial practices.",
    category: "Fiqh",
    thumbnail: img("finance"),
    price: 100,
    status: "published",
    sections: [
      {
        title: "Wealth in Islam",
        order: 1,
        lessons: [
          { title: "Zakah basics", order: 1, durationSeconds: 420 },
          { title: "Halal investing", order: 2, durationSeconds: 540 },
        ],
      },
    ],
  },
  {
    title: "Fiqh of Purification & Salah",
    description:
      "Comprehensive practical course on ritual purity, ablution, and prayer jurisprudence.",
    category: "Fiqh",
    thumbnail: img("fiqh"),
    price: 0,
    status: "published",
    sections: [
      {
        title: "Purification",
        order: 1,
        lessons: [
          { title: "Wudu and ghusl", order: 1, durationSeconds: 480 },
          { title: "The prayer", order: 2, durationSeconds: 420 },
        ],
      },
    ],
  },
  {
    title: "The 99 Names of Allah",
    description:
      "Memorize and understand the meanings of Asmaul Husna with practical reflections.",
    category: "Spirituality",
    thumbnail: img("asmaul-husna"),
    price: 0,
    status: "published",
    sections: [
      {
        title: "Names of Majesty",
        order: 1,
        lessons: [
          { title: "Al-Rahman, Al-Raheem", order: 1, durationSeconds: 300 },
          { title: "Al-Malik, Al-Quddus", order: 2, durationSeconds: 360 },
        ],
      },
    ],
  },
  {
    title: "Islamic Parenting",
    description:
      "Raising righteous children in today's world with Islamic principles.",
    category: "Family",
    thumbnail: img("parenting"),
    price: 50,
    status: "published",
    sections: [
      {
        title: "Foundations",
        order: 1,
        lessons: [
          { title: "Parenting with mercy", order: 1, durationSeconds: 480 },
          { title: "Instilling love of Allah", order: 2, durationSeconds: 540 },
        ],
      },
    ],
  },
];

/**
 * Insert seed courses into the database.
 *
 * @param {object} options
 * @param {import("mongoose").Model} options.Course - The Course model.
 * @param {boolean} [options.full] - Insert the comprehensive set (default: minimal).
 * @param {import("mongoose").Types.ObjectId} options.createdBy - User id that owns the courses.
 * @returns {Promise<import("mongoose").Document[]>} The inserted course documents.
 */
export const seedCourses = async ({ Course, full = false, createdBy }) => {
  const dataset = full ? fullCourses : minimalCourses;

  const courses = dataset.map((course) => ({
    ...course,
    createdBy,
    rating: 4.8,
    numReviews: 0,
    views: 0,
  }));

  return Course.insertMany(courses);
};

export default seedCourses;
