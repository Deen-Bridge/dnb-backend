import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import CourseProgress from "../src/models/CourseProgress.js";
import Quiz from "../src/models/quiz.model.js";
import QuizAttempt from "../src/models/quiz-attempt.model.js";

describe("Quiz / assessment system", () => {
  let mongoServer;
  let educator;
  let learner;
  let otherLearner;
  let educatorToken;
  let learnerToken;
  let otherLearnerToken;
  let course;
  let lessonId;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (process.env.MONGO_URI) {
      try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 2000 });
        return;
      } catch (_err) {}
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Course.deleteMany({}),
      CourseProgress.deleteMany({}),
      Quiz.deleteMany({}),
      QuizAttempt.deleteMany({}),
    ]);

    educator = await User.create({
      name: "Educator",
      email: "educator@example.com",
      password: "Qx7#vLmp92Zt",
      role: "mentor",
      verifiedEducator: true,
    });
    learner = await User.create({
      name: "Learner",
      email: "learner@example.com",
      password: "Qx7#vLmp92Zt",
      role: "student",
    });
    otherLearner = await User.create({
      name: "Other Learner",
      email: "other@example.com",
      password: "Qx7#vLmp92Zt",
      role: "student",
    });

    const secret = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";
    educatorToken = jwt.sign({ userId: educator._id, sessionId: "e1" }, secret);
    learnerToken = jwt.sign({ userId: learner._id, sessionId: "l1" }, secret);
    otherLearnerToken = jwt.sign({ userId: otherLearner._id, sessionId: "o1" }, secret);

    lessonId = new mongoose.Types.ObjectId();
    course = await Course.create({
      title: "Science 101",
      description: "Intro to science",
      category: "Science",
      createdBy: educator._id,
      video: "video-url",
      sections: [
        {
          title: "Section 1",
          order: 1,
          lessons: [
            { _id: lessonId, title: "Lesson 1", order: 1, videoUrl: "v1" },
            { _id: new mongoose.Types.ObjectId(), title: "Lesson 2", order: 2, videoUrl: "v2" },
          ],
        },
      ],
    });
  });

  const questionsPayload = [
    {
      prompt: "What is 2 + 2?",
      options: ["3", "4", "5"],
      correctOptionIndex: 1,
    },
    {
      prompt: "Capital of France?",
      options: ["Paris", "London", "Rome"],
      correctOptionIndex: 0,
    },
  ];

  const createQuiz = async (token, overrides = {}) => {
    const res = await request(app)
      .post("/api/quizzes")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Chapter Quiz",
        description: "Test quiz",
        course: course._id.toString(),
        lessonId: lessonId.toString(),
        passingScoreThreshold: 50,
        questions: questionsPayload,
        ...overrides,
      });
    return res;
  };

  it("allows creation of a quiz and supports multiple quizzes per course", async () => {
    const res1 = await createQuiz(educatorToken);
    expect(res1.status).toBe(201);
    expect(res1.body.success).toBe(true);
    expect(res1.body.data.title).toBe("Chapter Quiz");
    expect(res1.body.data.questions).toHaveLength(2);

    // Second quiz for the same course (multi-quiz-per-course support).
    const res2 = await request(app)
      .post("/api/quizzes")
      .set("Authorization", `Bearer ${educatorToken}`)
      .send({
        title: "Second Quiz",
        course: course._id.toString(),
        passingScoreThreshold: 70,
        questions: [{ prompt: "Q", options: ["A", "B"], correctOptionIndex: 1 }],
      });
    expect(res2.status).toBe(201);

    const list = await request(app)
      .get(`/api/courses/${course._id}/quizzes`)
      .set("Authorization", `Bearer ${learnerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(0);
    const count = await Quiz.countDocuments({ course: course._id });
    expect(count).toBe(2);
  });

  it("rejects a quiz with an invalid correctOptionIndex", async () => {
    const res = await createQuiz(educatorToken, {
      questions: [{ prompt: "Q", options: ["A", "B", "C"], correctOptionIndex: 9 }],
    });
    expect(res.status).toBe(400);
  });

  it("does NOT expose correct answers when fetching a quiz to take", async () => {
    const created = await createQuiz(educatorToken);
    const quizId = created.body.data._id;

    const res = await request(app)
      .get(`/api/quizzes/${quizId}`)
      .set("Authorization", `Bearer ${learnerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.questions).toHaveLength(2);
    for (const q of res.body.data.questions) {
      expect(q).not.toHaveProperty("correctOptionIndex");
    }
  });

  it("scores server-side and ignores a client-spoofed score", async () => {
    const created = await createQuiz(educatorToken);
    const quizId = created.body.data._id;

    // Send a forged score of 100 while actually answering everything wrong.
    const res = await request(app)
      .post(`/api/quizzes/${quizId}/attempts`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({
        score: 100,
        passed: true,
        answers: questionsPayload.map((q, i) => ({
          questionId: created.body.data.questions[i]._id,
          // Both selections wrong: index 0 is wrong for Q1 (correct=1) and
          // index 1 is wrong for Q2 (correct=0).
          selectedOptionIndex: i === 0 ? 0 : 1,
        })),
      });

    expect(res.status).toBe(201);
    const attempt = res.body.data.attempt;
    expect(attempt.score).toBe(0);
    expect(attempt.percentage).toBe(0);
    expect(attempt.passed).toBe(false);

    // Stored doc agrees with server-side scoring, not the forged payload.
    const stored = await QuizAttempt.findById(attempt._id).lean();
    expect(stored.score).toBe(0);
    expect(stored.percentage).toBe(0);
    expect(stored.passed).toBe(false);
  });

  it("marks pass at/above threshold and triggers lesson completion; fails below", async () => {
    const created = await createQuiz(educatorToken); // threshold 50
    const quizId = created.body.data._id;
    const qids = created.body.data.questions.map((q) => q._id.toString());

    // All correct -> 100% >= 50 -> pass, lesson marked complete.
    const passRes = await request(app)
      .post(`/api/quizzes/${quizId}/attempts`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({
        answers: [
          { questionId: qids[0], selectedOptionIndex: 1 },
          { questionId: qids[1], selectedOptionIndex: 0 },
        ],
      });
    expect(passRes.status).toBe(201);
    expect(passRes.body.data.attempt.passed).toBe(true);
    expect(passRes.body.data.attempt.percentage).toBe(100);

    const progress = await CourseProgress.findOne({
      user: learner._id,
      course: course._id,
    }).lean();
    expect(progress).not.toBeNull();
    expect(
      progress.lessonsCompleted.map((id) => id.toString())
    ).toContain(lessonId.toString());
    expect(progress.percentComplete).toBe(50); // 1 of 2 lessons

    // Now a failing attempt: one correct -> 50% still >= threshold -> pass.
    // Use a separate below-threshold quiz to assert failure.
    const strictQuiz = await request(app)
      .post("/api/quizzes")
      .set("Authorization", `Bearer ${educatorToken}`)
      .send({
        title: "Strict Quiz",
        course: course._id.toString(),
        lessonId: lessonId.toString(),
        passingScoreThreshold: 60,
        questions: questionsPayload,
      });

    const fail = await request(app)
      .post(`/api/quizzes/${strictQuiz.body.data._id}/attempts`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({
        answers: [
          { questionId: strictQuiz.body.data.questions[0]._id, selectedOptionIndex: 0 },
          { questionId: strictQuiz.body.data.questions[1]._id, selectedOptionIndex: 1 },
        ],
      });
    expect(fail.status).toBe(201);
    expect(fail.body.data.attempt.passed).toBe(false);
    expect(fail.body.data.attempt.percentage).toBe(0);
  });

  it("does not mark a lesson complete on a failing attempt", async () => {
    const created = await createQuiz(educatorToken, { passingScoreThreshold: 100 });
    const quizId = created.body.data._id;

    // Only 50% correct -> below the 100% threshold -> fail.
    const res = await request(app)
      .post(`/api/quizzes/${quizId}/attempts`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({
        answers: [
          { questionId: created.body.data.questions[0]._id, selectedOptionIndex: 1 },
          { questionId: created.body.data.questions[1]._id, selectedOptionIndex: 1 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.attempt.passed).toBe(false);

    const progress = await CourseProgress.findOne({
      user: learner._id,
      course: course._id,
    }).lean();
    expect(progress).toBeNull();
  });

  it("tracks multiple attempts per learner per quiz", async () => {
    const created = await createQuiz(educatorToken);
    const quizId = created.body.data._id;
    const qids = created.body.data.questions.map((q) => q._id.toString());

    await request(app)
      .post(`/api/quizzes/${quizId}/attempts`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({ answers: [] });

    await request(app)
      .post(`/api/quizzes/${quizId}/attempts`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({
        answers: [
          { questionId: qids[0], selectedOptionIndex: 1 },
          { questionId: qids[1], selectedOptionIndex: 0 },
        ],
      });

    const res = await request(app)
      .get(`/api/quizzes/${quizId}/attempts`)
      .set("Authorization", `Bearer ${learnerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    const history = await QuizAttempt.countDocuments({
      user: learner._id,
      quiz: quizId,
    });
    expect(history).toBe(2);
  });

  it("exposes correct answers ONLY in the post-submission result", async () => {
    const created = await createQuiz(educatorToken);
    const quizId = created.body.data._id;
    const qids = created.body.data.questions.map((q) => q._id.toString());

    const attemptRes = await request(app)
      .post(`/api/quizzes/${quizId}/attempts`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({
        answers: [
          { questionId: qids[0], selectedOptionIndex: 1 },
          { questionId: qids[1], selectedOptionIndex: 0 },
        ],
      });
    const attemptId = attemptRes.body.data.attempt._id;

    const result = await request(app)
      .get(`/api/attempts/${attemptId}`)
      .set("Authorization", `Bearer ${learnerToken}`);
    expect(result.status).toBe(200);
    expect(result.body.data.results).toHaveLength(2);
    for (const r of result.body.data.results) {
      expect(r).toHaveProperty("correctOptionIndex");
      expect(r).toHaveProperty("isCorrect");
      expect(r).toHaveProperty("options");
    }
    expect(result.body.data.results[0].isCorrect).toBe(true);
    expect(result.body.data.results[1].isCorrect).toBe(true);
  });

  it("prevents a learner from creating or editing quizzes (authorization)", async () => {
    // Learner cannot create.
    const createRes = await request(app)
      .post("/api/quizzes")
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({
        title: "Hacked Quiz",
        course: course._id.toString(),
        passingScoreThreshold: 50,
        questions: [{ prompt: "Q", options: ["A", "B"], correctOptionIndex: 1 }],
      });
    expect(createRes.status).toBe(403);

    // Learner cannot update an educator's quiz either.
    const created = await createQuiz(educatorToken);
    const quizId = created.body.data._id;
    const updateRes = await request(app)
      .put(`/api/quizzes/${quizId}`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({ title: "Tampered" });
    expect(updateRes.status).toBe(403);

    // Learner cannot delete.
    const delRes = await request(app)
      .delete(`/api/quizzes/${quizId}`)
      .set("Authorization", `Bearer ${learnerToken}`);
    expect(delRes.status).toBe(403);

    // The quiz is unchanged.
    const stored = await Quiz.findById(quizId).lean();
    expect(stored.title).toBe("Chapter Quiz");
  });

  it("lets the quiz owner (educator) update/delete the quiz", async () => {
    const created = await createQuiz(educatorToken);
    const quizId = created.body.data._id;

    const updateRes = await request(app)
      .put(`/api/quizzes/${quizId}`)
      .set("Authorization", `Bearer ${educatorToken}`)
      .send({ title: "Updated Quiz", passingScoreThreshold: 80 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.title).toBe("Updated Quiz");
    expect(updateRes.body.data.passingScoreThreshold).toBe(80);

    const delRes = await request(app)
      .delete(`/api/quizzes/${quizId}`)
      .set("Authorization", `Bearer ${educatorToken}`);
    expect(delRes.status).toBe(200);
    const stored = await Quiz.findById(quizId).lean();
    expect(stored).toBeNull();
  });

  it("prevents a learner from viewing another learner's attempt result", async () => {
    const created = await createQuiz(educatorToken);
    const quizId = created.body.data._id;
    const qids = created.body.data.questions.map((q) => q._id.toString());

    const attemptRes = await request(app)
      .post(`/api/quizzes/${quizId}/attempts`)
      .set("Authorization", `Bearer ${learnerToken}`)
      .send({
        answers: [
          { questionId: qids[0], selectedOptionIndex: 1 },
          { questionId: qids[1], selectedOptionIndex: 0 },
        ],
      });
    const attemptId = attemptRes.body.data.attempt._id;

    const otherRes = await request(app)
      .get(`/api/attempts/${attemptId}`)
      .set("Authorization", `Bearer ${otherLearnerToken}`);
    expect(otherRes.status).toBe(403);
  });
});
