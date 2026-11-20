import dotenv from "dotenv";
import mongoose from "mongoose";
import Space from "../models/Space.js";

dotenv.config();

const uniqueIds = (ids = []) => {
  const seen = new Set();
  return ids.filter((id) => {
    const key = id.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const reconcileSpaceMembership = (space) => {
  const enrolledUsers = uniqueIds(space.enrolledUsers);
  const enrolledIds = new Set(enrolledUsers.map((id) => id.toString()));
  const waitList = uniqueIds(space.waitList).filter((id) => !enrolledIds.has(id.toString()));
  const limitedEnrolledUsers = space.capacity
    ? enrolledUsers.slice(0, space.capacity)
    : enrolledUsers;

  const changed =
    enrolledUsers.length !== (space.enrolledUsers || []).length ||
    waitList.length !== (space.waitList || []).length ||
    limitedEnrolledUsers.length !== enrolledUsers.length;

  return { changed, enrolledUsers: limitedEnrolledUsers, waitList };
};

export const reconcileSpaceMemberships = async () => {
  let repaired = 0;
  const cursor = Space.find().cursor();

  for await (const space of cursor) {
    const membership = reconcileSpaceMembership(space);
    if (!membership.changed) continue;

    await Space.updateOne(
      { _id: space._id },
      { $set: { enrolledUsers: membership.enrolledUsers, waitList: membership.waitList } }
    );
    repaired += 1;
  }

  return { repaired };
};

if (process.argv[1] && process.argv[1].endsWith("reconcileSpaceMemberships.js")) {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI must be set to reconcile space memberships");
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const result = await reconcileSpaceMemberships();
    console.log(`Reconciled memberships for ${result.repaired} space(s).`);
  } finally {
    await mongoose.disconnect();
  }
}
