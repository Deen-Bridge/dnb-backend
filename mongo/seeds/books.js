// mongo/seeds/books.js
//
// Seed books for local development. A couple of the books carry audiobook
// fields (audioFileUrl / duration) so the audiobook player flow is testable
// right after seeding. `author` is expected to point at a seeded user.

const img = (seed) => `https://picsum.photos/seed/${seed}/800/600`;

const minimalBooks = [
  {
    title: "The Noble Qur'an: English Translation",
    category: "Qur'an & Tafsir",
    price: 0,
    description:
      "Clear English translation of the Qur'an with explanatory notes and commentary.",
    image: img("quran-en"),
    fileUrl: "https://example.com/books/quran-en.pdf",
    readCount: 15000,
  },
  {
    title: "Riyad us-Saliheen",
    category: "Hadith & Sunnah",
    price: 25,
    description:
      "A compilation of authentic Hadith on Islamic ethics, manners, and spiritual development.",
    image: img("riyad"),
    fileUrl: "https://example.com/books/riyad-salihin.pdf",
    readCount: 8000,
  },
  {
    title: "Fortress of the Muslim",
    category: "Duas & Dhikr",
    price: 10,
    description:
      "Comprehensive collection of authentic supplications and remembrances from the Quran and Sunnah.",
    image: img("fortress"),
    fileUrl: "https://example.com/books/fortress-muslim.pdf",
    // Audiobook example: audio served alongside the text file.
    audioFileUrl: "https://example.com/audio/fortress-muslim.mp3",
    audioFilePublicId: "seed/fortress-muslim",
    duration: 3720,
    readCount: 12000,
  },
];

const fullBooks = [
  ...minimalBooks,
  {
    title: "The Sealed Nectar",
    category: "Seerah",
    price: 30,
    description:
      "Award-winning biography of Prophet Muhammad ﷺ with detailed historical research.",
    image: img("sealed-nectar"),
    fileUrl: "https://example.com/books/sealed-nectar.pdf",
    readCount: 20000,
  },
  {
    title: "Al-Adab al-Mufrad",
    category: "Hadith & Sunnah",
    price: 20,
    description:
      "Imam Bukhari's collection of Hadith on Islamic manners and character.",
    image: img("adab"),
    fileUrl: "https://example.com/books/adab-mufrad.pdf",
    readCount: 5000,
  },
  {
    title: "Tafsir Ibn Kathir (Abridged)",
    category: "Qur'an & Tafsir",
    price: 45,
    description: "One of the most widely accepted Tafsir works explaining the Quran.",
    image: img("tafsir-kathir"),
    fileUrl: "https://example.com/books/tafsir-ibn-kathir.pdf",
    readCount: 9000,
  },
  {
    title: "Bulugh al-Maram",
    category: "Fiqh",
    price: 15,
    description: "Ibn Hajar's compilation of Hadith used as basis for Fiqh rulings.",
    image: img("bulugh"),
    fileUrl: "https://example.com/books/bulugh-maram.pdf",
    readCount: 6000,
  },
  {
    title: "Healing with the Quran",
    category: "Spirituality",
    price: 0,
    description:
      "Understanding the spiritual and physical healing properties of Quranic recitation.",
    image: img("healing"),
    fileUrl: "https://example.com/books/healing-quran.pdf",
    audioFileUrl: "https://example.com/audio/healing-quran.m4a",
    audioFilePublicId: "seed/healing-quran",
    duration: 5400,
    readCount: 7500,
  },
  {
    title: "Stories of the Prophets",
    category: "Islamic History",
    price: 35,
    description: "Comprehensive accounts of the prophets mentioned in the Quran.",
    image: img("prophets"),
    fileUrl: "https://example.com/books/stories-prophets.pdf",
    readCount: 11000,
  },
  {
    title: "The Path of the Seeker",
    category: "Spirituality",
    price: 0,
    description:
      "A guide for spiritual seekers on the path to Allah through purification of the soul.",
    image: img("seeker"),
    fileUrl: "https://example.com/books/path-seeker.pdf",
    readCount: 3500,
  },
];

/**
 * Insert seed books into the database.
 *
 * @param {object} options
 * @param {import("mongoose").Model} options.Book - The Book model.
 * @param {boolean} [options.full] - Insert the comprehensive set (default: minimal).
 * @param {import("mongoose").Types.ObjectId} options.author - User id that authored the books.
 * @returns {Promise<import("mongoose").Document[]>} The inserted book documents.
 */
export const seedBooks = async ({ Book, full = false, author }) => {
  const dataset = full ? fullBooks : minimalBooks;

  const books = dataset.map((book) => ({
    ...book,
    author,
    rating: 4.8,
    numReviews: 0,
  }));

  return Book.insertMany(books);
};

// Exported for tests/scripts that want to inspect the raw datasets.
export const bookDatasets = { minimal: minimalBooks, full: fullBooks };

export default seedBooks;
