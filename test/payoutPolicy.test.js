import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const recordAudit = jest.fn();
jest.unstable_mockModule("../src/services/audit/auditService.js", () => ({ recordAudit }));

const { authorizePayout, decidePayoutAccess, isPayoutOwnerOrAdmin, PAYOUT_CAPABILITIES } =
  await import("../src/security/payoutPolicy.js");

const users = {
  student: { _id: "student-1", role: "student", isActive: true },
  mentor: { _id: "mentor-1", role: "mentor", isActive: true },
  revokedAdmin: {
    _id: "admin-revoked",
    role: "admin",
    isActive: false,
    twoFactor: { enabled: true },
  },
  admin: {
    _id: "admin-1",
    role: "admin",
    isActive: true,
    twoFactor: { enabled: true },
  },
};

describe("central payout capability policy", () => {
  test("keeps read, initiate, and execute capabilities separate", () => {
    expect(decidePayoutAccess({ user: users.mentor, capability: PAYOUT_CAPABILITIES.READ_OWN })).toMatchObject({ allowed: true });
    expect(decidePayoutAccess({ user: users.mentor, capability: PAYOUT_CAPABILITIES.INITIATE })).toMatchObject({ allowed: false, reason: "role_not_permitted" });
    expect(decidePayoutAccess({ user: users.admin, capability: PAYOUT_CAPABILITIES.INITIATE, is2FAVerified: true })).toMatchObject({ allowed: true });
    expect(decidePayoutAccess({ user: users.admin, capability: PAYOUT_CAPABILITIES.EXECUTE, is2FAVerified: true })).toMatchObject({ allowed: true });
  });

  test("denies revoked accounts even when their role is admin", () => {
    expect(decidePayoutAccess({ user: users.revokedAdmin, capability: PAYOUT_CAPABILITIES.EXECUTE, is2FAVerified: true })).toMatchObject({ allowed: false, reason: "account_revoked" });
  });

  test("keeps owner reads scoped while allowing an admin boundary", () => {
    expect(isPayoutOwnerOrAdmin(users.mentor, "mentor-1")).toBe(true);
    expect(isPayoutOwnerOrAdmin(users.mentor, "another-user")).toBe(false);
    expect(isPayoutOwnerOrAdmin(users.admin, "another-user")).toBe(true);
    expect(decidePayoutAccess({
      user: users.mentor,
      capability: PAYOUT_CAPABILITIES.READ_OWN,
      ownerId: "another-user",
    })).toMatchObject({ allowed: false, reason: "not_owner" });
  });

  test("requires a verified 2FA session for admin funds movement", () => {
    expect(decidePayoutAccess({ user: users.admin, capability: PAYOUT_CAPABILITIES.INITIATE, is2FAVerified: false })).toMatchObject({ allowed: false, reason: "admin_2fa_required" });
    expect(decidePayoutAccess({ user: { ...users.admin, twoFactor: { enabled: false } }, capability: PAYOUT_CAPABILITIES.EXECUTE, is2FAVerified: true })).toMatchObject({ allowed: false, reason: "admin_2fa_required" });
  });

  test("audits actor, target, decision, and request id on denial", async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = users.mentor;
      req.id = "req-611";
      next();
    });
    app.post("/payouts/:batchId/submit", authorizePayout(PAYOUT_CAPABILITIES.EXECUTE), (_req, res) => res.sendStatus(204));

    const response = await request(app).post("/payouts/batch-611/submit");
    expect(response.status).toBe(403);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      actor: "mentor-1",
      targetType: "Payout",
      targetId: "batch-611",
      status: "failure",
      req: expect.objectContaining({ id: "req-611" }),
      metadata: expect.objectContaining({ capability: PAYOUT_CAPABILITIES.EXECUTE, decision: "denied" }),
    }));
  });
});
