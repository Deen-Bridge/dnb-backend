// mongo/seeds/users.js
//
// Seed users for local development. `seedUsers` inserts a small starter set by
// default; pass `full: true` for a larger, more varied set. Every seeded
// account uses the same development password so it is easy to log in as any of
// them: DeenBridge#2024

import bcrypt from "bcryptjs";

const PASSWORD = "DeenBridge#2024";

const minimalUsers = [
  {
    name: "Aisha Rahman",
    email: "admin@deenbridge.dev",
    role: "admin",
    isVerified: true,
    bio: "Platform administrator.",
    country: "NG",
  },
  {
    name: "Yusuf Abdullah",
    email: "instructor@deenbridge.dev",
    role: "mentor",
    isVerified: true,
    verifiedEducator: true,
    bio: "Educator creating courses, books and hosting spaces.",
    country: "NG",
  },
  {
    name: "Fatima Hassan",
    email: "learner@deenbridge.dev",
    role: "student",
    isVerified: true,
    bio: "Curious learner exploring the platform.",
    country: "US",
  },
];

const fullUsers = [
  ...minimalUsers,
  {
    name: "Omar Farouk",
    email: "omar@deenbridge.dev",
    role: "mentor",
    isVerified: true,
    verifiedEducator: true,
    bio: "Qur'an teacher and author.",
  },
  {
    name: "Maryam Bello",
    email: "maryam@deenbridge.dev",
    role: "student",
    isVerified: true,
    bio: "Student of Islamic sciences.",
  },
  {
    name: "Ibrahim Musa",
    email: "ibrahim@deenbridge.dev",
    role: "student",
    isVerified: true,
    bio: "Learning Arabic grammar.",
  },
  {
    name: "Zaynab Yusuf",
    email: "zaynab@deenbridge.dev",
    role: "mentor",
    isVerified: true,
    verifiedEducator: true,
    bio: "Fiqh instructor.",
  },
  {
    name: "Bilal Khan",
    email: "bilal@deenbridge.dev",
    role: "student",
    isVerified: true,
  },
  {
    name: "Khadija Omar",
    email: "khadija@deenbridge.dev",
    role: "student",
    isVerified: true,
  },
  {
    name: "Hassan Idris",
    email: "hassan@deenbridge.dev",
    role: "mentor",
    isVerified: true,
    verifiedEducator: true,
    bio: "Seerah storyteller.",
  },
];

/**
 * Insert seed users into the database.
 *
 * @param {object} options
 * @param {import("mongoose").Model} options.User - The User model.
 * @param {boolean} [options.full] - Insert the comprehensive set (default: minimal).
 * @returns {Promise<import("mongoose").Document[]>} The inserted user documents.
 */
export const seedUsers = async ({ User, full = false }) => {
  const dataset = full ? fullUsers : minimalUsers;

  const users = dataset.map(({ password, ...user }) => ({
    ...user,
    password: bcrypt.hashSync(PASSWORD, 10),
  }));

  return User.insertMany(users);
};

export default seedUsers;
