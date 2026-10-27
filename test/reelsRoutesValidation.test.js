// Request validation on /api/reels routes (issue #417). Controllers, auth and
// upload are stubbed so only the route-level validation chain is exercised.
import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const handler = jest.fn((req, res) => res.status(200).json({ success: true, body: req.body }));
const names = [
  "getReels", "getReelById", "createReel", "reactToReel", "addReelComment",
  "getReelComments", "deleteReelComment", "registerReelShare", "registerReelView",
  "createReelDuet", "getReelDerivatives",
];
jest.unstable_mockModule("../src/controllers/reelController.js", () =>
  Object.fromEntries(names.map((n) => [n, handler]))
);
jest.unstable_mockModule("../src/controllers/moderation.controller.js", () => ({
  flagReel: handler,
}));
jest.unstable_mockModule("../src/middlewares/authMiddleware.js", () => ({
  protect: (req, res, next) => next(),
}));
jest.unstable_mockModule("../src/middlewares/upload.js", () => ({
  default: { single: () => (req, res, next) => next() },
}));

const { default: router } = await import("../src/routes/reelsRoutes.js");
const { errorHandler } = await import("../src/middlewares/errorHandler.js");

const app = express();
app.use(express.json());
app.use("/api/reels", router);
app.use(errorHandler);

const ID = "507f1f77bcf86cd799439011";
const CID = "507f1f77bcf86cd799439012";

describe("reels routes validation", () => {
  beforeEach(() => handler.mockClear());

  const rejected = async (req) => {
    handler.mockClear();
    const res = await req;
    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  };

  it("GET / validates pagination", async () => {
    await request(app).get("/api/reels?page=2&limit=10").expect(200);
    await rejected(request(app).get("/api/reels?page=abc"));
  });

  it("GET /:id validates id", async () => {
    await request(app).get(`/api/reels/${ID}`).expect(200);
    await rejected(request(app).get("/api/reels/not-an-id"));
  });

  it("POST / validates description/tags and sanitizes", async () => {
    const ok = await request(app)
      .post("/api/reels")
      .send({ description: "hi <script>x</script>", category: "faith", tags: "a,b" })
      .expect(200);
    expect(ok.body.body.description).not.toMatch(/</);
    await request(app).post("/api/reels").send({ description: "d", tags: ["a", "b"] }).expect(200);
    handler.mockClear();
    await rejected(request(app).post("/api/reels").send({ category: "x" }));
    await rejected(request(app).post("/api/reels").send({ description: "d", tags: { a: 1 } }));
    await rejected(request(app).post("/api/reels").send({ description: "x".repeat(2001) }));
  });

  it("POST /:id/react accepts like/love only", async () => {
    await request(app).post(`/api/reels/${ID}/react`).send({ type: "love" }).expect(200);
    await rejected(request(app).post(`/api/reels/${ID}/react`).send({ type: "hate" }));
    await rejected(request(app).post("/api/reels/bad/react").send({ type: "like" }));
  });

  it("POST /:id/comments validates text and sanitizes", async () => {
    const ok = await request(app)
      .post(`/api/reels/${ID}/comments`)
      .send({ text: "<b>nice</b>" })
      .expect(200);
    expect(ok.body.body.text).toBe("nice");
    await rejected(request(app).post(`/api/reels/${ID}/comments`).send({ text: "   " }));
    await rejected(request(app).post(`/api/reels/${ID}/comments`).send({ text: { $gt: "" } }));
  });

  it("GET /:id/comments validates id and pagination", async () => {
    await request(app).get(`/api/reels/${ID}/comments?limit=20`).expect(200);
    await rejected(request(app).get(`/api/reels/${ID}/comments?limit=0`));
  });

  it("DELETE /:id/comments/:commentId validates both ids", async () => {
    await request(app).delete(`/api/reels/${ID}/comments/${CID}`).expect(200);
    await rejected(request(app).delete(`/api/reels/${ID}/comments/zzz`));
  });

  it("POST /:id/share and /view validate id", async () => {
    await request(app).post(`/api/reels/${ID}/share`).expect(200);
    await request(app).post(`/api/reels/${ID}/view`).expect(200);
    handler.mockClear();
    await rejected(request(app).post("/api/reels/bad/share"));
    await rejected(request(app).post("/api/reels/bad/view"));
  });

  it("POST /:reelId/flag validates reelId, reason, details", async () => {
    await request(app)
      .post(`/api/reels/${ID}/flag`)
      .send({ reason: "spam" })
      .expect(200);
    await request(app)
      .post(`/api/reels/${ID}/flag`)
      .send({ reason: "spam", details: "more" })
      .expect(200);
    handler.mockClear();
    await rejected(request(app).post(`/api/reels/${ID}/flag`).send({ reason: "" }));
    await rejected(request(app).post(`/api/reels/${ID}/flag`).send({ reason: { a: 1 } }));
    await rejected(request(app).post("/api/reels/bad/flag").send({ reason: "spam" }));
  });

  it("duet routes keep their existing validation", async () => {
    await rejected(request(app).post(`/api/reels/${ID}/duet`).send({ description: "d", type: "bad" }));
    await rejected(request(app).get(`/api/reels/${ID}/duets?type=bad`));
  });
});
