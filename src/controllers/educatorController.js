import Course from "../models/Course.js";
import Book from "../models/Book.js";
import Space from "../models/Space.js";
import { catchAsync } from "../middlewares/errorHandler.js";

// Public profile fields surfaced on educator cards.
const CREATOR_FIELDS = "name avatar role bio";

const VALID_TYPES = new Set(["all", "courses", "books", "spaces"]);

// The User role enum is a system concern ("student", "mentor", "admin"). Only
// mentor reads as a job title here; everything else falls back to "Educator"
// on the card instead of leaking a system role as a subtitle.
const ROLE_LABELS = {
  mentor: "Mentor",
};

/**
 * There is no "list educators" collection — the directory is derived from real
 * content. Every course carries a createdBy, every book an author, every space
 * a host. Aggregating those yields a genuine roster with real contribution
 * counts instead of placeholder people.
 */
export const getEducators = catchAsync(async (req, res) => {
  const { search, type = "all" } = req.query;
  const filterType = VALID_TYPES.has(type) ? type : "all";

  const [courses, books, spaces] = await Promise.all([
    Course.find()
      .select("createdBy")
      .populate("createdBy", CREATOR_FIELDS)
      .lean(),
    Book.find()
      .select("author")
      .populate("author", CREATOR_FIELDS)
      .lean(),
    Space.find()
      .select("host")
      .populate("host", CREATOR_FIELDS)
      .lean(),
  ]);

  const byId = new Map();

  const add = (person, key) => {
    const id = person?._id?.toString();
    if (!id) return;

    let entry = byId.get(id);
    if (!entry) {
      entry = {
        _id: id,
        name: person.name || "Unnamed educator",
        avatar: person.avatar || null,
        role: ROLE_LABELS[person.role] || null,
        bio: person.bio || null,
        courses: 0,
        books: 0,
        spaces: 0,
      };
      byId.set(id, entry);
    }
    entry[key] += 1;
  };

  courses.forEach((c) => add(c.createdBy, "courses"));
  books.forEach((b) => add(b.author, "books"));
  spaces.forEach((s) => add(s.host, "spaces"));

  const roster = [...byId.values()].map((e) => ({
    ...e,
    total: e.courses + e.books + e.spaces,
  }));

  let educators = roster;
  if (filterType === "courses") educators = educators.filter((e) => e.courses > 0);
  else if (filterType === "books") educators = educators.filter((e) => e.books > 0);
  else if (filterType === "spaces") educators = educators.filter((e) => e.spaces > 0);

  const q = (search || "").trim().toLowerCase();
  if (q) {
    educators = educators.filter(
      (e) => e.name.toLowerCase().includes(q) || (e.bio || "").toLowerCase().includes(q)
    );
  }

  educators.sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name)
  );

  res.status(200).json({
    success: true,
    data: educators,
    meta: {
      educators: roster.length,
      courses: roster.reduce((sum, e) => sum + e.courses, 0),
      books: roster.reduce((sum, e) => sum + e.books, 0),
      spaces: roster.reduce((sum, e) => sum + e.spaces, 0),
    },
  });
});
