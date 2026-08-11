import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../src/models/User.js";
import PendingUser from "../src/models/PendingUser.js";
import Book from "../src/models/Book.js";
import Space from "../src/models/Space.js";
import Course from "../src/models/Course.js";
import "../src/jobs/handlers.js";
import { protect, authorize, restrictTo } from "../src/middlewares/authMiddleware.js";
import { registerUser } from "../src/controllers/authController.js";
import { deleteBook } from "../src/controllers/books/bookController.js";
import { deleteSpace, updateSpace } from "../src/controllers/spaceController.js";
import { updateUser, deleteUser, getUser } from "../src/controllers/userController.js";
import { updateCourse } from "../src/controllers/courses/courseController.js";

describe("Role-Based Access Control (RBAC) & Anti-Escalation", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await PendingUser.deleteMany({});
    await Book.deleteMany({});
    await Space.deleteMany({});
    await Course.deleteMany({});
  });

  describe("User Model Role Enum Validation", () => {
    it("accepts valid canonical roles: student, mentor, admin", async () => {
      const validRoles = ["student", "mentor", "admin"];
      for (const role of validRoles) {
        const u = await User.create({
          name: `User ${role}`,
          email: `${role}@example.com`,
          password: "Qx7#vLmp92Zt",
          role,
        });
        expect(u.role).toBe(role);
      }
    });

    it("rejects invalid role strings", async () => {
      await expect(
        User.create({
          name: "Hacker User",
          email: "hacker@example.com",
          password: "Qx7#vLmp92Zt",
          role: "superadmin_hacker",
        })
      ).rejects.toThrow();
    });
  });

  describe("Authorize / RestrictTo Middleware", () => {
    it("allows access when user has one of the allowed roles", async () => {
      const app = express();
      app.get(
        "/admin-only",
        (req, _res, next) => {
          req.user = { role: "admin" };
          next();
        },
        authorize("admin"),
        (_req, res) => res.status(200).json({ success: true, message: "Welcome Admin" })
      );

      const res = await request(app).get("/admin-only");
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Welcome Admin");
    });

    it("blocks access with 403 Forbidden when user does not have required role", async () => {
      const app = express();
      app.get(
        "/mentor-only",
        (req, _res, next) => {
          req.user = { role: "student" };
          next();
        },
        restrictTo("mentor", "admin"),
        (_req, res) => res.status(200).json({ success: true })
      );

      const res = await request(app).get("/mentor-only");
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Forbidden");
    });
  });

  describe("Registration Anti-Privilege Escalation", () => {
    it("prevents self-assignment of admin during registration", async () => {
      const app = express();
      app.use(express.json());
      app.post("/register", registerUser);

      // Attempt to register as admin
      const resAdmin = await request(app).post("/register").send({
        name: "Self Admin",
        email: "self_admin@example.com",
        password: "Qx7#vLmp92Zt",
        role: "admin",
      });

      expect(resAdmin.status).toBe(201);
      const createdAdminUser = await PendingUser.findOne({ email: "self_admin@example.com" });
      expect(createdAdminUser.role).toBe("student");

      // Attempt to register with a non-existent privileged role
      const resArbiter = await request(app).post("/register").send({
        name: "Self Arbiter",
        email: "self_arbiter@example.com",
        password: "Qx7#vLmp92Zt",
        role: "moderator",
      });

      expect(resArbiter.status).toBe(201);
      const createdArbiterUser = await PendingUser.findOne({ email: "self_arbiter@example.com" });
      expect(createdArbiterUser.role).toBe("student");
    });

    it("allows mentor role during registration", async () => {
      const app = express();
      app.use(express.json());
      app.post("/register", registerUser);

      const resMentor = await request(app).post("/register").send({
        name: "Self Mentor",
        email: "self_mentor@example.com",
        password: "Qx7#vLmp92Zt",
        role: "mentor",
      });

      expect(resMentor.status).toBe(201);
      const createdMentorUser = await PendingUser.findOne({ email: "self_mentor@example.com" });
      expect(createdMentorUser.role).toBe("mentor");
    });

    it("downgrades tutor registration attempts to student", async () => {
      const app = express();
      app.use(express.json());
      app.post("/register", registerUser);

      const resTutor = await request(app).post("/register").send({
        name: "Self Tutor",
        email: "self_tutor@example.com",
        password: "Qx7#vLmp92Zt",
        role: "tutor",
      });

      expect(resTutor.status).toBe(201);
      const createdTutorUser = await PendingUser.findOne({ email: "self_tutor@example.com" });
      expect(createdTutorUser.role).toBe("student");
    });
  });

  describe("Owner or Admin Content & Account Authorization Gating", () => {
    let studentUser, authorUser, adminUser, testBook, testSpace;

    beforeEach(async () => {
      studentUser = await User.create({
        name: "Student",
        email: "student_auth@example.com",
        password: "Qx7#vLmp92Zt",
        role: "student",
      });

      authorUser = await User.create({
        name: "Author",
        email: "author_auth@example.com",
        password: "Qx7#vLmp92Zt",
        role: "mentor",
      });

      adminUser = await User.create({
        name: "Admin",
        email: "admin_auth@example.com",
        password: "Qx7#vLmp92Zt",
        role: "admin",
      });

      testBook = await Book.create({
        title: "Test Book",
        description: "Test Description",
        category: "Tech",
        price: 10,
        author: authorUser._id,
        thumbnail: "https://example.com/thumb.jpg",
        image: "https://example.com/thumb.jpg",
        fileUrl: "https://example.com/file.pdf",
      });

      testSpace = await Space.create({
        title: "Test Space",
        description: "Test Description",
        category: "Tech",
        host: authorUser._id,
        price: 0,
        eventDate: new Date(),
        eventTime: "10:00 AM",
        duration: 60,
      });
    });

    it("rejects book deletion by a non-author non-admin with 403 Forbidden", async () => {
      const app = express();
      app.use((req, _res, next) => {
        req.user = studentUser;
        next();
      });
      app.delete("/books/:id", deleteBook);

      const res = await request(app).delete(`/books/${testBook._id}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Not authorized to delete this book");

      // Verify book still exists
      const bookExists = await Book.findById(testBook._id);
      expect(bookExists).not.toBeNull();
    });

    it("allows book deletion by author or admin", async () => {
      const appAuthor = express();
      appAuthor.use((req, _res, next) => {
        req.user = authorUser;
        next();
      });
      appAuthor.delete("/books/:id", deleteBook);

      const resAuthor = await request(appAuthor).delete(`/books/${testBook._id}`);
      expect(resAuthor.status).toBe(200);
      expect(resAuthor.body.message).toBe("Book deleted");

      // Recreate book and test admin deletion
      const newBook = await Book.create({
        title: "New Book",
        description: "New Description",
        category: "Tech",
        price: 10,
        author: authorUser._id,
        thumbnail: "https://example.com/thumb.jpg",
        image: "https://example.com/thumb.jpg",
        fileUrl: "https://example.com/file.pdf",
      });

      const appAdmin = express();
      appAdmin.use((req, _res, next) => {
        req.user = adminUser;
        next();
      });
      appAdmin.delete("/books/:id", deleteBook);

      const resAdmin = await request(appAdmin).delete(`/books/${newBook._id}`);
      expect(resAdmin.status).toBe(200);
    });

    it("rejects space deletion and update by a non-host non-admin with 403 Forbidden", async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.user = studentUser;
        next();
      });
      app.delete("/spaces/:id", deleteSpace);
      app.put("/spaces/:id", updateSpace);

      const resDelete = await request(app).delete(`/spaces/${testSpace._id}`);
      expect(resDelete.status).toBe(403);

      const resUpdate = await request(app).put(`/spaces/${testSpace._id}`).send({ title: "Updated Title" });
      expect(resUpdate.status).toBe(403);
    });

    it("rejects profile update and account deletion of another user with 403 Forbidden", async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.user = studentUser;
        next();
      });
      app.put("/users/:id", updateUser);
      app.delete("/users/:id", deleteUser);

      const resUpdate = await request(app).put(`/users/${authorUser._id}`).send({ name: "Hacked Name" });
      expect(resUpdate.status).toBe(403);

      const resDelete = await request(app).delete(`/users/${authorUser._id}`);
      expect(resDelete.status).toBe(403);
    });

    it("allows self-update and self-delete", async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.user = studentUser;
        next();
      });
      app.put("/users/:id", updateUser);
      app.delete("/users/:id", deleteUser);

      const resUpdate = await request(app).put(`/users/${studentUser._id}`).send({ name: "Updated Self" });
      expect(resUpdate.status).toBe(200);
      expect(resUpdate.body.user.name).toBe("Updated Self");

      const resDelete = await request(app).delete(`/users/${studentUser._id}`);
      expect(resDelete.status).toBe(200);

      const deletedUser = await User.findById(studentUser._id);
      expect(deletedUser).toBeNull();
    });

    it("allows admin to update or delete any user", async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.user = adminUser;
        next();
      });
      app.put("/users/:id", updateUser);
      app.delete("/users/:id", deleteUser);

      const resUpdate = await request(app).put(`/users/${studentUser._id}`).send({ name: "Admin Updated" });
      expect(resUpdate.status).toBe(200);

      const resDelete = await request(app).delete(`/users/${authorUser._id}`);
      expect(resDelete.status).toBe(200);
    });

    it("rejects duplicate email update with 409", async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.user = studentUser;
        next();
      });
      app.put("/users/:id", updateUser);

      const res = await request(app)
        .put(`/users/${studentUser._id}`)
        .send({ email: authorUser.email });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("A user with this email already exists");
    });

    it("returns only public fields for non-self getUser", async () => {
      const app = express();
      app.use((req, _res, next) => {
        req.user = studentUser;
        next();
      });
      app.get("/users/:id", getUser);

      const res = await request(app).get(`/users/${authorUser._id}`);
      expect(res.status).toBe(200);

      const body = res.body.user;
      expect(body.name).toBeDefined();
      expect(body.role).toBeDefined();
      expect(body.email).toBeUndefined();
      expect(body.stellarWallet).toBeUndefined();
      expect(body.following).toBeUndefined();
      expect(body.followers).toBeUndefined();
      expect(body.purchasedBooks).toBeUndefined();
      expect(body.purchasedCourses).toBeUndefined();
    });

    it("returns full user document for self getUser", async () => {
      const app = express();
      app.use((req, _res, next) => {
        req.user = studentUser;
        next();
      });
      app.get("/users/:id", getUser);

      const res = await request(app).get(`/users/${studentUser._id}`);
      expect(res.status).toBe(200);

      const body = res.body.user;
      expect(body.name).toBeDefined();
      expect(body.email).toBeDefined();
      expect(body.following).toBeDefined();
      expect(body.followers).toBeDefined();
    });
  });
});
