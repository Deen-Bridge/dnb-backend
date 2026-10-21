import { body } from "express-validator";
import {
  SECURITY_QUESTION_IDS,
  REQUIRED_QUESTION_COUNT,
  MIN_ANSWER_LENGTH,
} from "../constants/securityQuestions.js";
import { normalizeAnswer } from "../utils/securityQuestions.js";

const answerItem = (path) =>
  body(path)
    .isString()
    .withMessage("answer must be a string")
    .bail()
    .custom((v) => normalizeAnswer(v).length >= MIN_ANSWER_LENGTH)
    .withMessage(`answer must be at least ${MIN_ANSWER_LENGTH} characters`)
    .isLength({ max: 200 })
    .withMessage("answer is too long");

const answersArray = body("answers")
  .isArray({ min: REQUIRED_QUESTION_COUNT, max: REQUIRED_QUESTION_COUNT })
  .withMessage(`Exactly ${REQUIRED_QUESTION_COUNT} answers are required`);

export const setupSecurityQuestionsValidation = [
  body("currentPassword").isString().notEmpty().withMessage("currentPassword is required"),
  answersArray,
  body("answers.*.questionId")
    .isString()
    .isIn(SECURITY_QUESTION_IDS)
    .withMessage("questionId must be one of the predefined questions"),
  answerItem("answers.*.answer"),
  body("answers").custom((arr) => {
    if (!Array.isArray(arr)) return true;
    const ids = new Set(arr.map((a) => a && a.questionId));
    if (ids.size !== arr.length) throw new Error("Questions must be distinct");
    return true;
  }),
];

export const recoverStartValidation = [
  body("email").isString().isEmail().withMessage("A valid email is required"),
];

export const recoverVerifyValidation = [
  body("email").isString().isEmail().withMessage("A valid email is required"),
  answersArray,
  body("answers.*.questionId").isString().withMessage("questionId is required"),
  body("answers.*.answer").isString().withMessage("answer must be a string"),
];
