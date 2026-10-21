import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Space from "../src/models/Space.js";
import SpacePoll from "../src/models/space-poll.model.js";
import PollVote from "../src/models/poll-vote.model.js";

const JWT_SECRET = process.env.JWT_SECRET;
const generateToken = (userId, role = "student") => {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "1h" });
};

describe("Space Polls API (#210)", () => {
  let mongoServer;
  let hostUser, participantUser, otherUser;
  let hostToken, participantToken, otherToken;
  let testSpace;

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
    await Space.deleteMany({});
    await SpacePoll.deleteMany({});
    await PollVote.deleteMany({});

    hostUser = await User.create({
      name: "Host User",
      email: "host@example.com",
      password: "Password123!",
      role: "mentor",
    });

    participantUser = await User.create({
      name: "Participant User",
      email: "participant@example.com",
      password: "Password123!",
      role: "student",
    });

    otherUser = await User.create({
      name: "Other User",
      email: "other@example.com",
      password: "Password123!",
      role: "student",
    });

    hostToken = generateToken(hostUser._id, "mentor");
    participantToken = generateToken(participantUser._id, "student");
    otherToken = generateToken(otherUser._id, "student");

    testSpace = await Space.create({
      title: "Live Tafsir Session",
      description: "Interactive Live Discussion",
      category: "Quran",
      host: hostUser._id,
      eventDate: new Date(),
      eventTime: "18:00",
      duration: 60,
      meetingRoom: "room-123-unique",
      meetingUrl: "https://meet.jit.si/room-123-unique",
    });
  });

  it("allows host to create polls with multiple choice options", async () => {
    const res = await request(app)
      .post(`/api/spaces/${testSpace._id}/polls`)
      .set("Authorization", `Bearer ${hostToken}`)
      .send({
        question: "Which surah topic should we discuss next?",
        options: ["Surah Yasin", "Surah Al-Kahf", "Surah Al-Mulk"],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.poll.question).toBe("Which surah topic should we discuss next?");
    expect(res.body.poll.results.length).toBe(3);
    expect(res.body.poll.status).toBe("active");
  });

  it("prevents non-host from creating a poll in a space", async () => {
    const res = await request(app)
      .post(`/api/spaces/${testSpace._id}/polls`)
      .set("Authorization", `Bearer ${participantToken}`)
      .send({
        question: "Unauthorized poll?",
        options: ["Yes", "No"],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("allows participants to vote in real-time and displays live vote counts and percentages", async () => {
    const pollRes = await request(app)
      .post(`/api/spaces/${testSpace._id}/polls`)
      .set("Authorization", `Bearer ${hostToken}`)
      .send({
        question: "Best session time?",
        options: ["Morning", "Evening"],
      });

    const pollId = pollRes.body.poll._id;

    const vote1 = await request(app)
      .post(`/api/spaces/polls/${pollId}/vote`)
      .set("Authorization", `Bearer ${participantToken}`)
      .send({ optionIndex: 0 });

    expect(vote1.status).toBe(200);
    expect(vote1.body.poll.totalVotes).toBe(1);
    expect(vote1.body.poll.results[0].votes).toBe(1);
    expect(vote1.body.poll.results[0].percentage).toBe(100);

    const vote2 = await request(app)
      .post(`/api/spaces/polls/${pollId}/vote`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ optionIndex: 1 });

    expect(vote2.status).toBe(200);
    expect(vote2.body.poll.totalVotes).toBe(2);
    expect(vote2.body.poll.results[0].percentage).toBe(50);
    expect(vote2.body.poll.results[1].percentage).toBe(50);
  });

  it("closes poll to stop new votes", async () => {
    const pollRes = await request(app)
      .post(`/api/spaces/${testSpace._id}/polls`)
      .set("Authorization", `Bearer ${hostToken}`)
      .send({
        question: "Ready to proceed?",
        options: ["Yes", "No"],
      });

    const pollId = pollRes.body.poll._id;

    const closeRes = await request(app)
      .patch(`/api/spaces/polls/${pollId}/close`)
      .set("Authorization", `Bearer ${hostToken}`);

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.poll.status).toBe("closed");

    const voteRes = await request(app)
      .post(`/api/spaces/polls/${pollId}/vote`)
      .set("Authorization", `Bearer ${participantToken}`)
      .send({ optionIndex: 0 });

    expect(voteRes.status).toBe(400);
    expect(voteRes.body.message).toContain("closed");
  });

  it("exports poll results in JSON and CSV format", async () => {
    const pollRes = await request(app)
      .post(`/api/spaces/${testSpace._id}/polls`)
      .set("Authorization", `Bearer ${hostToken}`)
      .send({
        question: "Rating?",
        options: ["Excellent", "Good"],
      });

    const pollId = pollRes.body.poll._id;

    await request(app)
      .post(`/api/spaces/polls/${pollId}/vote`)
      .set("Authorization", `Bearer ${participantToken}`)
      .send({ optionIndex: 0 });

    const jsonExport = await request(app)
      .get(`/api/spaces/polls/${pollId}/export`)
      .set("Authorization", `Bearer ${hostToken}`);

    expect(jsonExport.status).toBe(200);
    expect(jsonExport.body.export.question).toBe("Rating?");
    expect(jsonExport.body.export.totalVotes).toBe(1);

    const csvExport = await request(app)
      .get(`/api/spaces/polls/${pollId}/export?format=csv`)
      .set("Authorization", `Bearer ${hostToken}`);

    expect(csvExport.status).toBe(200);
    expect(csvExport.text).toContain("Option Index,Option Text,Votes,Percentage");
  });

  it("supports multiple polls per space session", async () => {
    await request(app)
      .post(`/api/spaces/${testSpace._id}/polls`)
      .set("Authorization", `Bearer ${hostToken}`)
      .send({
        question: "Poll #1",
        options: ["A", "B"],
      });

    await request(app)
      .post(`/api/spaces/${testSpace._id}/polls`)
      .set("Authorization", `Bearer ${hostToken}`)
      .send({
        question: "Poll #2",
        options: ["C", "D"],
      });

    const listRes = await request(app)
      .get(`/api/spaces/${testSpace._id}/polls`)
      .set("Authorization", `Bearer ${participantToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.polls.length).toBe(2);
  });
});
