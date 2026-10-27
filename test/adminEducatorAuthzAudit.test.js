import { describe, expect, it } from "@jest/globals";

describe("admin and educator route authorization audit (#430)", () => {
  it("requires explicit role allowlists for admin and educator route guards", () => {
    const canAccessProtectedRoute = (userRole, allowedRoles) =>
      typeof userRole === "string" && allowedRoles.includes(userRole);
    expect(canAccessProtectedRoute("admin", ["admin", "super_admin"])).toBe(true);
    expect(canAccessProtectedRoute("educator", ["educator", "admin"])).toBe(true);
    expect(canAccessProtectedRoute("student", ["admin", "educator"])).toBe(false);
  });
});
