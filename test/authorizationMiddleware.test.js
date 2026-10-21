import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import {
  authorizeRoles,
  authorize,
  restrictTo,
  require2FA,
  requireVerified,
  requireVerifiedEducator,
} from "../src/middlewares/authMiddleware.js";
import { authorizeOwnership } from "../src/middlewares/authorize.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";

// Role matrix. The "educator" persona is stored as role "mentor"
// (User.role enum: student | mentor | admin); educator-only gates use the
// "mentor" role plus the verifiedEducator flag.
const USERS = {
  student: { _id: "s1", role: "student", isVerified: true },
  mentor: { _id: "m1", role: "mentor", isVerified: true, verifiedEducator: true },
  unverifiedMentor: { _id: "m2", role: "mentor", isVerified: true, verifiedEducator: false },
  admin: { _id: "a1", role: "admin", isVerified: true, twoFactor: { enabled: true } },
};

const buildApp = (user, guards, { is2FAVerified = true } = {}) => {
  const app = express();
  app.use((req, _res, next) => {
    if (user) req.user = user;
    req.is2FAVerified = is2FAVerified;
    next();
  });
  app.get("/protected", ...guards, (_req, res) => res.status(200).json({ success: true }));
  app.use(errorHandler);
  return app;
};

const hit = (user, guards, opts) => request(buildApp(user, guards, opts)).get("/protected");

describe("authorizeRoles allow/deny matrix", () => {
  const matrix = [
    // [guard roles, student, mentor, admin]
    [["admin"], 403, 403, 200],
    [["mentor"], 403, 200, 403],
    [["mentor", "admin"], 403, 200, 200],
    [["student"], 200, 403, 403],
    [["student", "mentor", "admin"], 200, 200, 200],
  ];

  test.each(matrix)("roles %j -> student %i, mentor %i, admin %i", async (roles, s, m, a) => {
    expect((await hit(USERS.student, [authorizeRoles(...roles)])).status).toBe(s);
    expect((await hit(USERS.mentor, [authorizeRoles(...roles)])).status).toBe(m);
    expect((await hit(USERS.admin, [authorizeRoles(...roles)])).status).toBe(a);
  });

  test("authorize and restrictTo are aliases with identical behaviour", async () => {
    for (const factory of [authorize, restrictTo]) {
      expect((await hit(USERS.student, [factory("mentor", "admin")])).status).toBe(403);
      expect((await hit(USERS.mentor, [factory("mentor", "admin")])).status).toBe(200);
    }
  });

  test("denies when no roles are allowed", async () => {
    expect((await hit(USERS.admin, [authorizeRoles()])).status).toBe(403);
  });

  test("role comparison is exact (no case folding, no 'educator' alias)", async () => {
    expect((await hit(USERS.mentor, [authorizeRoles("Mentor")])).status).toBe(403);
    expect((await hit(USERS.mentor, [authorizeRoles("educator")])).status).toBe(403);
    expect((await hit({ _id: "x", role: undefined }, [authorizeRoles("student")])).status).toBe(403);
  });

  test("missing req.user yields 403 (authorizeRoles does not distinguish 401)", async () => {
    const res = await hit(null, [authorizeRoles("student", "mentor", "admin")]);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test("deny response lists the required roles", async () => {
    const res = await hit(USERS.student, [authorizeRoles("mentor", "admin")]);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("mentor, admin");
  });
});

describe("admin 2FA enforcement inside authorizeRoles", () => {
  test("admin without 2FA enabled is denied", async () => {
    const admin = { ...USERS.admin, twoFactor: { enabled: false } };
    const res = await hit(admin, [authorizeRoles("admin")]);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/TOTP/);
  });

  test("admin with 2FA but unverified session is denied", async () => {
    const res = await hit(USERS.admin, [authorizeRoles("admin")], { is2FAVerified: false });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/2FA-verified/);
  });

  test("admin with verified 2FA session is allowed", async () => {
    expect((await hit(USERS.admin, [authorizeRoles("admin")])).status).toBe(200);
  });

  test("non-admin roles are not subject to the 2FA check", async () => {
    expect((await hit(USERS.mentor, [authorizeRoles("mentor")], { is2FAVerified: false })).status).toBe(200);
  });
});

describe("mentor -> educator mapping (requireVerifiedEducator)", () => {
  test("verified mentor (educator) allowed", async () => {
    expect((await hit(USERS.mentor, [requireVerifiedEducator])).status).toBe(200);
  });

  test("unverified mentor denied with 403", async () => {
    const res = await hit(USERS.unverifiedMentor, [requireVerifiedEducator]);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/verified educator/);
  });

  test("student denied with 403", async () => {
    expect((await hit(USERS.student, [requireVerifiedEducator])).status).toBe(403);
  });

  test("admin bypasses educator verification", async () => {
    expect((await hit(USERS.admin, [requireVerifiedEducator])).status).toBe(200);
  });

  test("missing user -> 401", async () => {
    const res = await hit(null, [requireVerifiedEducator]);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("combined gate authorizeRoles('mentor','admin') + requireVerifiedEducator", async () => {
    const guards = [authorizeRoles("mentor", "admin"), requireVerifiedEducator];
    expect((await hit(USERS.student, guards)).status).toBe(403);
    expect((await hit(USERS.unverifiedMentor, guards)).status).toBe(403);
    expect((await hit(USERS.mentor, guards)).status).toBe(200);
    expect((await hit(USERS.admin, guards)).status).toBe(200);
  });
});

describe("401 vs 403 for auth-state guards", () => {
  test.each([
    ["require2FA", require2FA],
    ["requireVerified", requireVerified],
    ["requireVerifiedEducator", requireVerifiedEducator],
  ])("%s returns 401 when unauthenticated", async (_n, guard) => {
    const res = await hit(null, [guard]);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: "Not authenticated" });
  });

  test("requireVerified: unverified email -> 403, verified -> 200", async () => {
    expect((await hit({ ...USERS.student, isVerified: false }, [requireVerified])).status).toBe(403);
    expect((await hit(USERS.student, [requireVerified])).status).toBe(200);
  });

  test("require2FA: 403 without 2FA or unverified session, 200 otherwise", async () => {
    expect((await hit(USERS.student, [require2FA])).status).toBe(403);
    const u = { ...USERS.student, twoFactor: { enabled: true } };
    expect((await hit(u, [require2FA], { is2FAVerified: false })).status).toBe(403);
    expect((await hit(u, [require2FA])).status).toBe(200);
  });
});

describe("authorizeOwnership role handling and standard error shape", () => {
  const makeModel = (doc) => ({ findById: jest.fn().mockResolvedValue(doc) });
  const doc = { _id: "d1", owner: { toString: () => "m1" } };
  const guard = (model) =>
    authorizeOwnership({ model, ownerField: "owner", resourceType: "Book" });
  const run = (user, model) =>
    request(
      (() => {
        const app = express();
        app.use((req, _res, next) => {
          req.user = user;
          next();
        });
        app.delete("/:id", guard(model), (_req, res) => res.json({ success: true }));
        app.use(errorHandler);
        return app;
      })()
    ).delete("/d1");

  test("owner mentor allowed", async () => {
    expect((await run(USERS.mentor, makeModel(doc))).status).toBe(200);
  });

  test("admin allowed on someone else's resource", async () => {
    expect((await run(USERS.admin, makeModel(doc))).status).toBe(200);
  });

  test("student and non-owner mentor denied with standard 403 shape", async () => {
    for (const u of [USERS.student, USERS.unverifiedMentor]) {
      const res = await run(u, makeModel(doc));
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(typeof res.body.error.message).toBe("string");
      expect(res.body.status).toBe("fail");
    }
  });

  test("missing resource -> standard 404", async () => {
    const res = await run(USERS.admin, makeModel(null));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
