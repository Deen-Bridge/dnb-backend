import mongoose from "mongoose";
import Reel from "../src/models/Reel.js";

/**
 * Regression guard: `Reel` declares `commentCount` as a stored path, so a
 * virtual of the same name makes mongoose throw at model-load time
 * ("Virtual path \"commentCount\" conflicts with a real path in the schema").
 *
 * Because every suite imports `app.js` (which registers the models), that one
 * duplicate stopped the entire test run at import — this file would otherwise
 * be the first to fail.
 */
describe("Reel commentCount is a stored path, not a virtual", () => {
  it("registers commentCount as a schema path", () => {
    expect(Reel.schema.path("commentCount")).toBeDefined();
    expect(Reel.schema.path("commentCount").instance).toBe("Number");
  });

  it("does not shadow it with a virtual of the same name", () => {
    expect(Reel.schema.virtuals.commentCount).toBeUndefined();
  });

  it("serialises the stored counter, and defaults it to 0", () => {
    const reel = new Reel({
      description: "Reel used by the commentCount regression guard",
      video: "https://cdn.example.com/reel.mp4",
      createdBy: new mongoose.Types.ObjectId(),
    });

    expect(reel.commentCount).toBe(0);
    expect(reel.toJSON().commentCount).toBe(0);

    reel.commentCount = 3;
    expect(reel.toJSON().commentCount).toBe(3);
  });

  it("keeps the derived like/love virtuals working", () => {
    const reel = new Reel({
      description: "Derived counters",
      video: "https://cdn.example.com/reel.mp4",
      createdBy: new mongoose.Types.ObjectId(),
      likes: [new mongoose.Types.ObjectId()],
    });

    expect(reel.toJSON().likeCount).toBe(1);
    expect(reel.toJSON().loveCount).toBe(0);
  });
});
