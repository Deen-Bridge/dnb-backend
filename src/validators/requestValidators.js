import { body } from "express-validator";
import mongoose from "mongoose";
import * as StellarSdk from "@stellar/stellar-sdk";
import { isValidPublicKey, NETWORK } from "../services/stellar/stellarService.js";
import { PASSWORD_MIN } from "../utils/passwordPolicy.js";

const networkPassphrase =
  NETWORK === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const isWellFormedXdr = (value) => {
  try {
    StellarSdk.TransactionBuilder.fromXDR(value, networkPassphrase);
    return true;
  } catch {
    return false;
  }
};

const requiredString = (field, message) =>
  body(field)
    .exists({ values: "null" })
    .withMessage(message)
    .bail()
    .isString()
    .withMessage(`${field} must be a string`)
    .bail()
    .trim()
    .notEmpty()
    .withMessage(message)
    .bail();

const objectIdField = (field) =>
  requiredString(field, `${field} is required`)
    .custom(isValidObjectId)
    .withMessage(`${field} must be a valid Mongo ObjectId`);

export const registerValidation = [
  requiredString("name", "Name is required"),
  body("email")
    .exists({ values: "null" })
    .withMessage("Email is required")
    .bail()
    .isString()
    .withMessage("Email must be a string")
    .bail()
    .trim()
    .isEmail()
    .withMessage("Email must be a valid email address")
    .normalizeEmail(),
  body("password")
    .exists({ values: "null" })
    .withMessage("Password is required")
    .bail()
    .isString()
    .withMessage("Password must be a string")
    .bail()
    .isLength({ min: PASSWORD_MIN })
    .withMessage(`Password must be at least ${PASSWORD_MIN} characters`),
  body("role")
    .optional({ values: "undefined" })
    .isIn(["student", "mentor", "admin"])
    .withMessage("Role must be one of: student, mentor, admin"),
];

export const loginValidation = [
  body("email")
    .exists({ values: "null" })
    .withMessage("Email is required")
    .bail()
    .isString()
    .withMessage("Email must be a string")
    .bail()
    .trim()
    .isEmail()
    .withMessage("Email must be a valid email address")
    .normalizeEmail(),
  body("password")
    .exists({ values: "null" })
    .withMessage("Password is required")
    .bail()
    .isString()
    .withMessage("Password must be a string")
    .bail()
    .custom((value) => value.trim().length > 0)
    .withMessage("Password is required"),
];

export const initializePaymentValidation = [
  body("itemType")
    .exists({ values: "null" })
    .withMessage("itemType is required")
    .bail()
    .isIn(["book", "course"])
    .withMessage("itemType must be one of: book, course"),
  objectIdField("itemId"),
  requiredString("buyerWallet", "buyerWallet is required").custom(isValidPublicKey)
    .withMessage("buyerWallet must be a valid Stellar public key"),
];

export const submitPaymentValidation = [
  objectIdField("transactionId"),
  requiredString("signedXdr", "signedXdr is required")
    .custom(isWellFormedXdr)
    .withMessage("signedXdr must be a well-formed Stellar transaction XDR"),
];

export const connectWalletValidation = [
  requiredString("publicKey", "publicKey is required")
    .custom(isValidPublicKey)
    .withMessage("publicKey must be a valid Stellar public key"),
];

export default {
  registerValidation,
  loginValidation,
  initializePaymentValidation,
  submitPaymentValidation,
  connectWalletValidation,
};
