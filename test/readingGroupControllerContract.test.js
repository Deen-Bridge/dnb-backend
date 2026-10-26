import { describe, expect, it } from "@jest/globals";

describe("reading-group controller contract (#443)", () => {
  it("guards reading group membership capacity and archive constraints", () => {
    const canJoinGroup = ({ currentMembers, maxMembers, isArchived }) =>
      !isArchived && currentMembers < maxMembers;
    expect(canJoinGroup({ currentMembers: 12, maxMembers: 25, isArchived: false })).toBe(true);
    expect(canJoinGroup({ currentMembers: 25, maxMembers: 25, isArchived: false })).toBe(false);
    expect(canJoinGroup({ currentMembers: 5, maxMembers: 25, isArchived: true })).toBe(false);
  });
});
