import { body } from "express-validator";

const endpointRule = body("endpoint")
  .isString()
  .withMessage("endpoint must be a string")
  .bail()
  .isURL({ protocols: ["https"], require_protocol: true, require_tld: false })
  .withMessage("endpoint must be an https URL");

export const subscribeValidator = [
  endpointRule,
  body("keys.p256dh").isString().trim().notEmpty().withMessage("keys.p256dh is required"),
  body("keys.auth").isString().trim().notEmpty().withMessage("keys.auth is required"),
];

export const unsubscribeValidator = [endpointRule];

export const preferenceValidator = [
  body("enabled").isBoolean({ strict: true }).withMessage("enabled must be a boolean"),
];
