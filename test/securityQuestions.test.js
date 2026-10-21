import { jest } from "@jest/globals";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import app from "../app.js";
import User from "../src/models/User.js";
import SecurityQuestions from "../src/models/SecurityQuestions.js";
import { fakeQuestionIds, normalizeAnswer } from "../src/utils/securityQuestions.js";
import { verifyOtp } from "../src/utils/otp.js";

const answers3 = [
  { questionId: "first_pet", answer: "  Fluffy  " },
  { questionId: "birth_city", answer: "Lagos" },
  { questionId: "first_job", answer: "Tutor  Man" },
];

describe("Security questions recovery", () => {
  jest.setTimeout(60000);
  let user, token, saved;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
    user = {
      _id: "64b000000000000000000001",
      email: "sq@example.com",
      password: await bcrypt.hash("Passw0rd!long", 4),
      role: "student",
      save: jest.fn().mockResolvedValue(true),
    };
    token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  });

  beforeEach(() => {
    saved = null;
    user.save.mockClear();
    user.resetTokenHash = undefined;
    const q = (v) => ({ select: () => v, then: (r) => r(v) });
    jest.spyOn(User, "findById").mockImplementation(() => q(user));
    jest.spyOn(User, "findOne").mockImplementation((query) =>
      q(query.email === user.email ? user : null)
    );
    jest.spyOn(SecurityQuestions, "findOneAndUpdate").mockImplementation(async (_f, doc) => {
      saved = doc;
      return doc;
    });
    jest.spyOn(SecurityQuestions, "findOne").mockImplementation(async () => saved);
  });
  afterEach(() => jest.restoreAllMocks());

  it("lists predefined questions publicly", async () => {
    const res = await request(app).get("/api/auth/security-questions/list");
    expect(res.status).toBe(200);
    expect(res.body.data.questions.length).toBeGreaterThanOrEqual(8);
  });

  it("rejects duplicate questions and custom ids", async () => {
    const dup = [answers3[0], { ...answers3[1], questionId: "first_pet" }, answers3[2]];
    const r1 = await request(app).post("/api/auth/security-questions")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "Passw0rd!long", answers: dup });
    expect(r1.status).toBe(400);
    const custom = [answers3[0], { questionId: "my own q", answer: "abcd" }, answers3[2]];
    const r2 = await request(app).post("/api/auth/security-questions")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "Passw0rd!long", answers: custom });
    expect(r2.status).toBe(400);
    const r3 = await request(app).post("/api/auth/security-questions")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "Passw0rd!long", answers: answers3.slice(0, 2) });
    expect(r3.status).toBe(400);
  });

  it("hashes answers (stored hash != answer) and verify issues a reset OTP", async () => {
    const setup = await request(app).post("/api/auth/security-questions")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "Passw0rd!long", answers: answers3 });
    expect(setup.status).toBe(200);
    expect(saved.questions).toHaveLength(3);
    for (const q of saved.questions) {
      expect(q.answerHash).not.toMatch(/fluffy|lagos|tutor/i);
      expect(q.answerHash.startsWith("$2")).toBe(true);
    }

    const start = await request(app).post("/api/auth/recover/questions/start").send({ email: user.email });
    expect(start.body.data.questionIds).toEqual(["first_pet", "birth_city", "first_job"]);

    // normalization: case + whitespace insensitive
    const ok = await request(app).post("/api/auth/recover/questions/verify").send({
      email: user.email,
      answers: [
        { questionId: "first_pet", answer: "FLUFFY" },
        { questionId: "birth_city", answer: " lagos " },
        { questionId: "first_job", answer: "tutor man" },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.otp).toMatch(/^\d{6}$/);
    expect(await verifyOtp(ok.body.data.otp, user.resetTokenHash)).toBe(true);
    expect(user.save).toHaveBeenCalled();

    const bad = await request(app).post("/api/auth/recover/questions/verify").send({
      email: user.email,
      answers: [
        { questionId: "first_pet", answer: "fluffy" },
        { questionId: "birth_city", answer: "abuja" },
        { questionId: "first_job", answer: "tutor man" },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.data?.otp).toBeUndefined();
  });

  it("unknown user gets deterministic fake questions and generic failure", async () => {
    const a = await request(app).post("/api/auth/recover/questions/start").send({ email: "nobody@example.com" });
    const b = await request(app).post("/api/auth/recover/questions/start").send({ email: "nobody@example.com" });
    expect(a.status).toBe(200);
    expect(a.body.data.questionIds).toEqual(b.body.data.questionIds);
    expect(a.body.data.questionIds).toEqual(fakeQuestionIds("nobody@example.com"));
    expect(new Set(a.body.data.questionIds).size).toBe(3);

    const v = await request(app).post("/api/auth/recover/questions/verify").send({
      email: "nobody@example.com",
      answers: a.body.data.questionIds.map((questionId) => ({ questionId, answer: "whatever" })),
    });
    expect(v.status).toBe(400);
  });

  it("normalizes answers", () => {
    expect(normalizeAnswer("  A   B ")).toBe("a b");
  });
});
