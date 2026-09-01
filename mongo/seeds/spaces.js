// mongo/seeds/spaces.js
//
// Seed live/upcoming spaces for local development. `host` is expected to point
// at a seeded user. Meeting room ids are randomised so repeated runs do not
// collide on the unique `meetingRoom` index.

const img = (seed) => `https://picsum.photos/seed/${seed}/800/600`;

const now = () => Date.now();
const hoursFromNow = (hours) => new Date(now() + hours * 60 * 60 * 1000);
const meetingId = (i) =>
  `deenbridge-seed-space-${i}-${Math.random().toString(36).slice(2, 8)}`;

const minimalSpaces = [
  {
    title: "Qur'an Study Circle",
    description:
      "Weekly group study and reflection on selected Qur'anic verses. Open to all levels.",
    category: "Qur'an & Tafsir",
    thumbnail: img("quran-circle"),
    price: 0,
    status: "upcoming",
    eventDate: hoursFromNow(24),
    eventTime: "18:00",
    duration: 60,
    meetingRoom: meetingId(1),
    meetingUrl: `https://meet.jit.si/${meetingId(1)}`,
  },
  {
    title: "Fiqh Q&A Session",
    description:
      "Open floor for questions on Islamic jurisprudence and daily practice.",
    category: "Fiqh",
    thumbnail: img("fiqh-qa"),
    price: 0,
    status: "upcoming",
    eventDate: hoursFromNow(48),
    eventTime: "20:00",
    duration: 90,
    meetingRoom: meetingId(2),
    meetingUrl: `https://meet.jit.si/${meetingId(2)}`,
  },
  {
    title: "Sisters' Halaqa",
    description:
      "Weekly gathering for sisters to learn and connect in a safe environment.",
    category: "For Sisters",
    thumbnail: img("sisters"),
    price: 0,
    status: "upcoming",
    eventDate: hoursFromNow(72),
    eventTime: "15:00",
    duration: 60,
    meetingRoom: meetingId(3),
    meetingUrl: `https://meet.jit.si/${meetingId(3)}`,
  },
];

const fullSpaces = [
  ...minimalSpaces,
  {
    title: "Hadith Memorization Group",
    description:
      "Structured program to memorize and understand authentic Hadith with explanations.",
    category: "Hadith & Sunnah",
    thumbnail: img("hadith-group"),
    host: null, // replaced below
    price: 25,
    status: "upcoming",
    eventDate: hoursFromNow(120),
    eventTime: "19:30",
    duration: 75,
    meetingRoom: meetingId(4),
    meetingUrl: `https://meet.jit.si/${meetingId(4)}`,
  },
  {
    title: "Arabic Conversation Practice",
    description:
      "Practice spoken Arabic in a supportive environment for all skill levels.",
    category: "Language",
    thumbnail: img("arabic-practice"),
    price: 10,
    status: "upcoming",
    eventDate: hoursFromNow(12),
    eventTime: "17:00",
    duration: 45,
    meetingRoom: meetingId(5),
    meetingUrl: `https://meet.jit.si/${meetingId(5)}`,
  },
  {
    title: "Tazkiyah: Purification of the Heart",
    description:
      "Exploring spiritual diseases and their cures based on classical Islamic works.",
    category: "Spirituality",
    thumbnail: img("tazkiyah"),
    price: 0,
    status: "upcoming",
    eventDate: hoursFromNow(36),
    eventTime: "21:00",
    duration: 60,
    meetingRoom: meetingId(6),
    meetingUrl: `https://meet.jit.si/${meetingId(6)}`,
  },
  {
    title: "Youth Mentorship Circle",
    description:
      "Guidance and mentorship for young Muslims navigating modern challenges.",
    category: "For Youth",
    thumbnail: img("youth"),
    price: 0,
    status: "upcoming",
    eventDate: hoursFromNow(168),
    eventTime: "16:00",
    duration: 120,
    meetingRoom: meetingId(7),
    meetingUrl: `https://meet.jit.si/${meetingId(7)}`,
  },
  {
    title: "Islamic Marriage Workshop",
    description:
      "Practical guidance on marriage in Islam from engagement to daily life.",
    category: "Family",
    thumbnail: img("marriage"),
    price: 50,
    status: "upcoming",
    eventDate: hoursFromNow(336),
    eventTime: "14:00",
    duration: 180,
    meetingRoom: meetingId(8),
    meetingUrl: `https://meet.jit.si/${meetingId(8)}`,
  },
  {
    title: "Seerah Stories for Children",
    description:
      "Engaging sessions teaching children about the life of Prophet Muhammad ﷺ.",
    category: "For Children",
    thumbnail: img("children"),
    price: 0,
    status: "upcoming",
    eventDate: hoursFromNow(48),
    eventTime: "10:00",
    duration: 45,
    meetingRoom: meetingId(9),
    meetingUrl: `https://meet.jit.si/${meetingId(9)}`,
  },
  {
    title: "Dawah & Outreach Training",
    description:
      "Learn effective ways to share Islam with others in today's diverse society.",
    category: "Dawah & Outreach",
    thumbnail: img("dawah"),
    price: 0,
    status: "upcoming",
    eventDate: hoursFromNow(240),
    eventTime: "18:30",
    duration: 90,
    meetingRoom: meetingId(10),
    meetingUrl: `https://meet.jit.si/${meetingId(10)}`,
  },
];

/**
 * Insert seed spaces into the database.
 *
 * @param {object} options
 * @param {import("mongoose").Model} options.Space - The Space model.
 * @param {boolean} [options.full] - Insert the comprehensive set (default: minimal).
 * @param {import("mongoose").Types.ObjectId} options.host - User id hosting the spaces.
 * @returns {Promise<import("mongoose").Document[]>} The inserted space documents.
 */
export const seedSpaces = async ({ Space, full = false, host }) => {
  const dataset = full ? fullSpaces : minimalSpaces;

  const spaces = dataset.map((space) => ({
    ...space,
    host,
  }));

  return Space.insertMany(spaces);
};

export default seedSpaces;
