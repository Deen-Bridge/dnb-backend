import { spawnSync } from "child_process";
import { jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import axios from "axios";
import app from "../app.js";
import User from "../src/models/User.js";
import PendingUser from "../src/models/PendingUser.js";
import Session from "../src/models/Session.js";
import Book from "../src/models/Book.js";
import { testOutbox } from "../services/emails/sendMail.js";

const PASSWORD = "Qx7#vLmp92Zt";

describe("Core auth, authorization, and wallet flows", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    jest.spyOn(axios, "get").mockResolvedValue({ data: "" });
  }, 30000);

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      PendingUser.deleteMany({}),
      Session.deleteMany({}),
      Book.deleteMany({}),
    ]);
    testOutbox.length = 0;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const createVerifiedUser = async (overrides = {}) => {
    const { password = PASSWORD, ...fields } = overrides;
    return User.create({
      name: "Test User",
      email: "user@example.com",
      password: await bcrypt.hash(password, 12),
      role: "student",
      isVerified: true,
      ...fields,
    });
  };

  const login = async (email, password = PASSWORD) => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email, password });
    return response.body.accessToken;
  };

  it("imports the app without database or environment validation side effects", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import("./app.js").then(() => console.log("app-imported"))',
      ],
      {
        cwd: process.cwd(),
        env: { NODE_ENV: "test", PATH: process.env.PATH },
        encoding: "utf8",
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("app-imported");
    expect(result.stderr).toBe("");
  });

  it("registers, verifies, and logs in a user", async () => {
    const email = "new.user@example.com";
    const registration = await request(app).post("/api/auth/register").send({
      name: "New User",
      email,
      password: PASSWORD,
      role: "student",
    });

    expect(registration.status).toBe(201);
    expect(registration.body.success).toBe(true);
    expect(testOutbox).toHaveLength(1);

    const pending = await PendingUser.findOne({ email });
    expect(pending).not.toBeNull();
    expect(pending.password).not.toBe(PASSWORD);

    const verification = await request(app).get(
      `/api/auth/verify-email/${pending.verificationToken}`
    );
    expect(verification.status).toBe(200);
    expect(verification.body.accessToken).toBeTruthy();

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ email, password: PASSWORD });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.accessToken).toBeTruthy();
    expect(loginResponse.body.user.email).toBe(email);
  });

  it("rejects an incorrect password without issuing a token", async () => {
    await createVerifiedUser({ email: "wrong.password@example.com" });

    const response = await request(app).post("/api/auth/login").send({
      email: "wrong.password@example.com",
      password: "NotTheRightPassword1!",
    });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid credentials");
    expect(response.body.accessToken).toBeUndefined();
  });

  it("rejects a non-owner attempting to delete another user's book", async () => {
    const owner = await createVerifiedUser({
      name: "Owner",
      email: "owner@example.com",
    });
    const otherUser = await createVerifiedUser({
      name: "Other User",
      email: "other@example.com",
    });
    const book = await Book.create({
      title: "Owner's Book",
      author: owner._id,
      category: "History",
      description: "A protected book",
      image: "https://example.com/image.jpg",
      fileUrl: "https://example.com/book.pdf",
    });
    const otherToken = await login(otherUser.email);

    const response = await request(app)
      .delete(`/api/books/${book._id}`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(response.status).toBe(403);
    expect(await Book.exists({ _id: book._id })).not.toBeNull();
  });

  it("rejects an invalid Stellar public key before querying Horizon", async () => {
    const user = await createVerifiedUser({ email: "wallet@example.com" });
    const token = await login(user.email);

    const response = await request(app)
      .post("/api/stellar/wallet/connect")
      .set("Authorization", `Bearer ${token}`)
      .send({ publicKey: "not-a-stellar-public-key" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid Stellar public key",
    });

    const persisted = await User.findById(user._id).select("stellarWallet");
    expect(persisted.stellarWallet?.publicKey).toBeUndefined();
  });
});
