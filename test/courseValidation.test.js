import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import { validate } from "../src/middlewares/validate.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import logger from "../src/config/logger.js";
import * as v from "../src/validators/courseValidators.js";

const ID = "507f1f77bcf86cd799439011";
const ok = (req, res) => res.status(200).json({ ok: true });

const app = express();
app.use(express.json());
app.get("/courses", v.listCoursesValidation, validate, ok);
app.get("/courses/user", v.coursesByUserValidation, validate, ok);
app.post("/courses", v.createCourseValidation, validate, ok);
app.put("/courses/:id", v.updateCourseValidation, validate, ok);
app.post("/courses/recommended", v.recommendedCoursesValidation, validate, ok);
app.post("/courses/:id/enroll", v.courseIdParamValidation, validate, ok);
app.post("/courses/:id/reviews", v.createReviewValidation, validate, ok);
app.post("/courses/:id/progress", v.courseProgressUpdateValidation, validate, ok);
app.post("/purchase/course", v.purchaseCourseValidation, validate, ok);
app.get("/quizzes/:quizId", v.quizIdParamValidation, validate, ok);
app.get("/courses/:courseId/quizzes", v.courseQuizzesListValidation, validate, ok);
app.use(errorHandler);

beforeAll(() => {
  jest.spyOn(logger, "warn").mockImplementation(() => {});
});

const good = { title: "Fiqh 101", description: "Intro", category: "Fiqh", price: 10 };

describe("course request validation", () => {
  test("create course", async () => {
    expect((await request(app).post("/courses").send(good)).status).toBe(200);
    expect((await request(app).post("/courses").send({ ...good, thumbnail: null, video: "u", prerequisites: [ID] })).status).toBe(200);
    const bad = await request(app).post("/courses").send({ ...good, price: -5 });
    expect(bad.status).toBe(400);
    expect((await request(app).post("/courses").send({ description: "x", category: "y" })).status).toBe(400);
  });
  test("update course", async () => {
    expect((await request(app).put(`/courses/${ID}`).send({ price: 0 })).status).toBe(200);
    expect((await request(app).put("/courses/nope").send({ price: 0 })).status).toBe(400);
    expect((await request(app).put(`/courses/${ID}`).send({ title: { $ne: 1 } })).status).toBe(400);
  });
  test("enroll / id params", async () => {
    expect((await request(app).post(`/courses/${ID}/enroll`)).status).toBe(200);
    expect((await request(app).post("/courses/abc/enroll")).status).toBe(400);
  });
  test("list queries", async () => {
    expect((await request(app).get("/courses?page=2&limit=10&category=Fiqh")).status).toBe(200);
    expect((await request(app).get("/courses?page=abc")).status).toBe(400);
    expect((await request(app).get(`/courses/user?createdBy=${ID}`)).status).toBe(200);
    expect((await request(app).get("/courses/user?createdBy=x")).status).toBe(400);
  });
  test("recommended", async () => {
    expect((await request(app).post("/courses/recommended").send({ interests: ["a"] })).status).toBe(200);
    expect((await request(app).post("/courses/recommended").send({})).status).toBe(200);
    expect((await request(app).post("/courses/recommended").send({ interests: "a" })).status).toBe(400);
  });
  test("reviews and progress", async () => {
    expect((await request(app).post(`/courses/${ID}/reviews`).send({ rating: 5, comment: "great" })).status).toBe(200);
    expect((await request(app).post(`/courses/${ID}/reviews`).send({ rating: 9, comment: "x" })).status).toBe(400);
    expect((await request(app).post(`/courses/${ID}/progress`).send({ lessonId: ID, lastPositionSeconds: 12 })).status).toBe(200);
    expect((await request(app).post(`/courses/${ID}/progress`).send({ lessonId: "bad" })).status).toBe(400);
  });
  test("purchase", async () => {
    expect((await request(app).post("/purchase/course").send({ courseId: ID })).status).toBe(200);
    expect((await request(app).post("/purchase/course").send({ courseId: "x" })).status).toBe(400);
  });
  test("quizzes", async () => {
    expect((await request(app).get(`/quizzes/${ID}`)).status).toBe(200);
    expect((await request(app).get("/quizzes/zzz")).status).toBe(400);
    expect((await request(app).get(`/courses/${ID}/quizzes?page=1&limit=5`)).status).toBe(200);
    expect((await request(app).get(`/courses/${ID}/quizzes?limit=0`)).status).toBe(400);
  });
});
