import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import ReadingGroup from "../src/models/reading-group.model.js";
import ReadingGroupMember from "../src/models/reading-group-member.model.js";

const JWT_SECRET = process.env.JWT_SECRET;
const generateToken = (userId, role = "student") => {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "1h" });
};

describe("Book Clubs / Reading Groups API (#205)", () => {
  let mongoServer;
  let creatorUser, memberUser, inviteeUser, authorUser;
  let creatorToken, memberToken, inviteeToken;
  let testBook;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 60000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Book.deleteMany({});
    await ReadingGroup.deleteMany({});
    await ReadingGroupMember.deleteMany({});

    creatorUser = await User.create({
      name: "Group Creator",
      email: "creator@example.com",
      password: "Password123!",
      role: "student",
    });

    memberUser = await User.create({
      name: "Group Member",
      email: "member@example.com",
      password: "Password123!",
      role: "student",
    });

    inviteeUser = await User.create({
      name: "Invited Member",
      email: "invitee@example.com",
      password: "Password123!",
      role: "student",
    });

    authorUser = await User.create({
      name: "Imam An-Nawawi",
      email: "author@example.com",
      password: "Password123!",
      role: "mentor",
    });

    creatorToken = generateToken(creatorUser._id, "student");
    memberToken = generateToken(memberUser._id, "student");
    inviteeToken = generateToken(inviteeUser._id, "student");

    testBook = await Book.create({
      title: "Riyad as-Salihin",
      author: authorUser._id,
      description: "Gardens of the Righteous",
      category: "Hadith",
      price: 0,
      image: "https://example.com/cover.jpg",
      fileUrl: "https://example.com/book.pdf",
    });
  });

  it("creates reading groups for specific books", async () => {
    const res = await request(app)
      .post("/api/books/reading-groups")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        name: "Riyad Study Club",
        description: "Weekly Hadith discussion",
        bookId: testBook._id,
        privacy: "public",
        chaptersPerWeek: 2,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.group.name).toBe("Riyad Study Club");
  });

  it("invites members or allows joining public/private groups", async () => {
    const createRes = await request(app)
      .post("/api/books/reading-groups")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        name: "Private Hadith Group",
        bookId: testBook._id,
        privacy: "private",
      });

    const groupId = createRes.body.group._id;

    const joinRes = await request(app)
      .post(`/api/books/reading-groups/${groupId}/join`)
      .set("Authorization", `Bearer ${memberToken}`);

    expect(joinRes.status).toBe(200);
    expect(joinRes.body.membership.status).toBe("pending");

    const inviteRes = await request(app)
      .post(`/api/books/reading-groups/${groupId}/invite`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({ targetUserId: inviteeUser._id });

    expect(inviteRes.status).toBe(200);
    expect(inviteRes.body.membership.status).toBe("invited");
  });

  it("sets reading schedules (chapters per week)", async () => {
    const createRes = await request(app)
      .post("/api/books/reading-groups")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        name: "Scheduled Group",
        bookId: testBook._id,
      });

    const groupId = createRes.body.group._id;

    const scheduleRes = await request(app)
      .put(`/api/books/reading-groups/${groupId}/schedule`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        chaptersPerWeek: 3,
        readingSchedule: [
          { chapter: 1, title: "Sincerity and Intention", targetPages: "1-10" },
          { chapter: 2, title: "Repentance", targetPages: "11-25" },
        ],
      });

    expect(scheduleRes.status).toBe(200);
    expect(scheduleRes.body.group.chaptersPerWeek).toBe(3);
    expect(scheduleRes.body.group.readingSchedule.length).toBe(2);
  });

  it("supports group discussion threads per chapter", async () => {
    const createRes = await request(app)
      .post("/api/books/reading-groups")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        name: "Discussion Group",
        bookId: testBook._id,
      });

    const groupId = createRes.body.group._id;

    const postRes = await request(app)
      .post(`/api/books/reading-groups/${groupId}/discussions`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        chapter: 1,
        content: "What are your key takeaways regarding Niyyah (Intention)?",
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.discussions.length).toBe(1);

    const getRes = await request(app)
      .get(`/api/books/reading-groups/${groupId}/discussions?chapter=1`)
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.discussions[0].content).toContain("key takeaways");
  });

  it("tracks member progress in group dashboard", async () => {
    const createRes = await request(app)
      .post("/api/books/reading-groups")
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        name: "Dashboard Group",
        bookId: testBook._id,
      });

    const groupId = createRes.body.group._id;

    const progressRes = await request(app)
      .put(`/api/books/reading-groups/${groupId}/progress`)
      .set("Authorization", `Bearer ${creatorToken}`)
      .send({
        currentChapter: 5,
        currentProgressPercent: 50,
      });

    expect(progressRes.status).toBe(200);
    expect(progressRes.body.member.currentChapter).toBe(5);

    const dashRes = await request(app)
      .get(`/api/books/reading-groups/${groupId}/dashboard`)
      .set("Authorization", `Bearer ${creatorToken}`);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.stats.totalMembers).toBe(1);
    expect(dashRes.body.stats.avgProgressPercent).toBe(50);
  });
});
