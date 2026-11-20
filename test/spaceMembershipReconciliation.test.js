import { reconcileSpaceMembership } from "../src/migrations/reconcileSpaceMemberships.js";

describe("space membership reconciliation", () => {
  test("deduplicates memberships, lets enrollment win, and respects capacity", () => {
    const result = reconcileSpaceMembership({
      capacity: 1,
      enrolledUsers: ["user-1", "user-1"],
      waitList: ["user-1", "user-2", "user-2"],
    });

    expect(result).toEqual({
      changed: true,
      enrolledUsers: ["user-1"],
      waitList: ["user-2"],
    });
  });

  test("leaves valid memberships unchanged", () => {
    expect(
      reconcileSpaceMembership({
        capacity: 2,
        enrolledUsers: ["user-1"],
        waitList: ["user-2"],
      })
    ).toEqual({
      changed: false,
      enrolledUsers: ["user-1"],
      waitList: ["user-2"],
    });
  });
});
